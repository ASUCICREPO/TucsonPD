"""
Process Document Module

This module handles the generation of redaction proposals using Nova Pro vision.
It converts each PDF page to an image, sends them to Bedrock Nova Pro for analysis,
and creates a JSON file containing all proposed redactions with bounding box coordinates.

Flow:
1. Download unredacted PDF from S3
2. Render all pages to images using PyMuPDF
3. Generate document summary from page 1 image
4. Get active guideline from DynamoDB and download its JSON from S3
5. Process each page image with Nova Pro (single pass: identify redactions + coordinates)
6. Compile all redactions into single JSON document
7. Upload redaction-proposals.json to S3
8. Update DynamoDB status to "REVIEW_READY"
"""

import os
import json
import base64
import logging
import time
from typing import Dict, Any, List, Tuple
import fitz  # PyMuPDF
import boto3

from utils import (
    download_from_s3,
    upload_to_s3,
    update_dynamodb_status,
    converse_with_bedrock,
    get_active_guideline_from_db
)
from bedrock_config import get_prompt, get_config, get_id
from constants import (
    STATUS_PROCESSING,
    STATUS_REVIEW_READY,
    STATUS_FAILED,
    S3_BUCKET_NAME,
    S3_PATH_GUIDELINE_JSON
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# DPI for page rendering — 150 is sufficient for Nova vision, 200 for higher quality scans
PAGE_RENDER_DPI = 150
# Nova coordinate scale
NOVA_COORD_SCALE = 1000.0


def render_pdf_pages(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """
    Render all pages of a PDF to PNG images using PyMuPDF.
    
    Args:
        pdf_bytes: Raw PDF file bytes
        
    Returns:
        List of dicts, one per page:
        {
            "page_num": 1,            # 1-based
            "image_b64": "...",       # base64-encoded PNG
            "width_pts": 612.0,       # page width in PDF points
            "height_pts": 792.0,      # page height in PDF points
            "width_px": 1275,         # rendered image width in pixels
            "height_px": 1650         # rendered image height in pixels
        }
    """
    pages = []
    pdf_document = fitz.open(stream=pdf_bytes, filetype="pdf")
    
    try:
        total_pages = len(pdf_document)
        logger.info(f"Rendering {total_pages} pages at {PAGE_RENDER_DPI} DPI")
        
        # Scale factor: PDF points are 1/72 inch, so DPI/72 gives pixels per point
        scale = PAGE_RENDER_DPI / 72.0
        matrix = fitz.Matrix(scale, scale)
        
        for page_index in range(total_pages):
            page = pdf_document[page_index]
            
            # Render to pixmap (PNG in memory)
            pixmap = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB)
            png_bytes = pixmap.tobytes("png")
            image_b64 = base64.b64encode(png_bytes).decode('utf-8')
            
            pages.append({
                "page_num": page_index + 1,
                "image_b64": image_b64,
                "width_pts": page.rect.width,
                "height_pts": page.rect.height,
                "width_px": pixmap.width,
                "height_px": pixmap.height
            })
            
            logger.info(
                f"Rendered page {page_index + 1}/{total_pages} "
                f"({pixmap.width}x{pixmap.height}px, "
                f"{page.rect.width:.1f}x{page.rect.height:.1f}pts)"
            )
        
        return pages
        
    finally:
        pdf_document.close()


def nova_coords_to_pdf_points(
    bbox: Dict[str, float],
    width_pts: float,
    height_pts: float
) -> Dict[str, float]:
    """
    Convert Nova Pro bounding box coordinates ([0, 1000) scale) to PDF points.
    
    Nova uses top-left origin with [0, 1000) scale.
    PyMuPDF also uses top-left origin for Rect construction when applying redactions.
    So no axis flip is needed — just scale.
    
    Args:
        bbox: Dict with x0, y0, x1, y1 in [0, 1000) scale
        width_pts: Page width in PDF points
        height_pts: Page height in PDF points
        
    Returns:
        Dict with x0, y0, x1, y1 in PDF points
    """
    return {
        "x0": (bbox["x0"] / NOVA_COORD_SCALE) * width_pts,
        "y0": (bbox["y0"] / NOVA_COORD_SCALE) * height_pts,
        "x1": (bbox["x1"] / NOVA_COORD_SCALE) * width_pts,
        "y1": (bbox["y1"] / NOVA_COORD_SCALE) * height_pts
    }


def generate_document_summary(first_page: Dict[str, Any]) -> str:
    """
    Generate a summary of the document using the first page image.
    Police reports have their case overview on page 1, making this sufficient
    context for the per-page analysis prompts.
    
    Args:
        first_page: Page dict from render_pdf_pages (page 1)
        
    Returns:
        Document summary as a string
    """
    logger.info("Generating document summary from page 1 image")
    
    message = {
        "role": "user",
        "content": [
            {
                "image": {
                    "format": "png",
                    "source": {
                        "bytes": base64.b64decode(first_page["image_b64"])
                    }
                }
            },
            {
                "text": "Please provide a brief summary of this document."
            }
        ]
    }
    
    response = converse_with_bedrock(
        model_id=get_id("document_summary"),
        messages=[message],
        system_prompts=get_prompt("document_summary"),
        inference_config=get_config("document_summary")
    )
    
    summary = response["output"]["message"]["content"][0]["text"]
    logger.info(f"Document summary generated: {summary[:200]}...")
    return summary


def analyze_page_with_nova(
    page: Dict[str, Any],
    guidelines_json: str,
    document_summary: str
) -> List[Dict[str, Any]]:
    """
    Send a single page image to Nova Pro for redaction identification.
    Nova returns redaction text, rules, and bounding box coordinates in one pass.
    
    Args:
        page: Page dict from render_pdf_pages
        guidelines_json: JSON string of active redaction guidelines
        document_summary: Summary of full document for context
        
    Returns:
        List of redaction objects for this page, each with pdf_points coordinates:
        [
            {
                "page": 1,
                "text": "Clark Kent",
                "instance": 1,
                "rules": ["1"],
                "bbox_nova": {"x0": 120, "y0": 340, "x1": 210, "y1": 360},
                "bbox_pts": {"x0": 74.2, "y0": 210.0, "x1": 129.5, "y1": 222.5}
            }
        ]
    """
    page_num = page["page_num"]
    logger.info(f"Analyzing page {page_num} with Nova Pro")
    
    start_time = time.time()
    
    message = {
        "role": "user",
        "content": [
            {
                "image": {
                    "format": "png",
                    "source": {
                        "bytes": base64.b64decode(page["image_b64"])
                    }
                }
            },
            {
                "text": f"Analyze page {page_num} for required redactions."
            }
        ]
    }
    
    system_prompts = get_prompt(
        "page_analysis",
        guidelines=guidelines_json,
        doc_summary=document_summary,
        page_number=page_num
    )
    
    response = converse_with_bedrock(
        model_id=get_id("page_analysis"),
        messages=[message],
        system_prompts=system_prompts,
        inference_config=get_config("page_analysis")
    )
    
    elapsed = time.time() - start_time
    logger.info(f"Nova Pro responded for page {page_num} in {elapsed:.1f}s")
    
    response_text = response["output"]["message"]["content"][0]["text"].strip()
    
    # Strip markdown fences if present
    if response_text.startswith("```json"):
        response_text = response_text[7:]
    if response_text.startswith("```"):
        response_text = response_text[3:]
    if response_text.endswith("```"):
        response_text = response_text[:-3]
    
    try:
        redactions = json.loads(response_text.strip())
    except json.JSONDecodeError as e:
        logger.warning(f"Initial JSON parse failed on page {page_num}: {e}. Attempting repair.")
        redactions = attempt_json_repair(response_text, page_num)
        if redactions is None:
            return []
    
    if not isinstance(redactions, list):
        logger.error(f"Expected list from Nova on page {page_num}, got {type(redactions)}")
        return []
    
    # Convert Nova [0,1000) coordinates to PDF points
    validated = []
    for i, redaction in enumerate(redactions):
        # Validate required fields
        required_fields = ["page", "text", "instance", "rules", "bbox"]
        missing = [f for f in required_fields if f not in redaction]
        if missing:
            logger.warning(f"Page {page_num}, redaction {i}: missing fields {missing}, skipping")
            continue
        
        bbox_nova = redaction["bbox"]
        
        # Sanitize bbox_nova — strip any spurious keys Nova hallucinated,
        # keeping only the four expected coordinate keys
        bbox_nova_clean = {
            k: bbox_nova[k]
            for k in ["x0", "y0", "x1", "y1"]
            if k in bbox_nova
        }

        # Validate all four keys survived sanitization
        if not all(k in bbox_nova_clean for k in ["x0", "y0", "x1", "y1"]):
            logger.warning(
                f"Page {page_num}, redaction {i} ('{redaction.get('text', 'unknown')}'): "
                f"bbox missing required keys after sanitization: {bbox_nova}, skipping"
            )
            continue

        # Validate coordinate ranges
        if not all(0 <= bbox_nova_clean[k] <= 1000 for k in ["x0", "y0", "x1", "y1"]):
            logger.warning(
                f"Page {page_num}, redaction {i} ('{redaction.get('text', 'unknown')}'): "
                f"bbox out of [0, 1000] range: {bbox_nova_clean}, skipping"
            )
            continue

        # Convert to PDF points
        bbox_pts = nova_coords_to_pdf_points(
            bbox_nova_clean,
            page["width_pts"],
            page["height_pts"]
        )

        redaction["bbox_nova"] = bbox_nova_clean
        redaction["bbox_pts"] = bbox_pts
        # Remove original bbox key, replaced by the two above for clarity
        del redaction["bbox"]
        
        validated.append(redaction)
    
    logger.info(f"Page {page_num}: {len(validated)} valid redactions (of {len(redactions)} proposed)")
    return validated


def process_pages_for_redactions(
    pages: List[Dict[str, Any]],
    guidelines_json: str,
    document_summary: str
) -> List[Dict[str, Any]]:
    """
    Process all pages sequentially to identify redactions.
    
    Args:
        pages: List of page dicts from render_pdf_pages
        guidelines_json: JSON string of active redaction guidelines
        document_summary: Summary of full document
        
    Returns:
        List of all redaction objects across all pages
    """
    all_redactions = []
    total_pages = len(pages)
    
    for page in pages:
        page_num = page["page_num"]
        logger.info(f"Processing page {page_num}/{total_pages}")
        
        page_redactions = analyze_page_with_nova(
            page=page,
            guidelines_json=guidelines_json,
            document_summary=document_summary
        )
        
        logger.info(f"Page {page_num}: found {len(page_redactions)} redactions")
        all_redactions.extend(page_redactions)
    
    return all_redactions


def process_document(case_id: str, s3_paths: Dict[str, str]) -> Dict[str, Any]:
    """
    Generate redaction proposals for a document using Nova Pro vision analysis.
    
    Args:
        case_id: Unique case identifier
        s3_paths: Dictionary containing S3 paths for all relevant files
        
    Returns:
        Dictionary with processing results
        
    Raises:
        Exception: If any step fails
    """
    logger.info(f"Starting document processing for case: {case_id}")
    
    update_dynamodb_status(
        case_id=case_id,
        status=STATUS_PROCESSING,
        metadata={"stage": "starting_document_analysis"}
    )
    
    try:
        # Step 1: Download unredacted PDF
        logger.info("Downloading unredacted PDF from S3")
        unredacted_pdf_bytes = download_from_s3(s3_paths["unredacted_doc"])
        
        # Step 2: Render all pages to images once — used for both summary and analysis
        logger.info("Rendering PDF pages to images")
        pages = render_pdf_pages(unredacted_pdf_bytes)
        total_pages = len(pages)
        logger.info(f"Rendered {total_pages} pages")
        
        update_dynamodb_status(
            case_id=case_id,
            status=STATUS_PROCESSING,
            metadata={"stage": "analyzing_document", "total_pages": total_pages}
        )
        
        # Step 3: Generate document summary from page 1
        logger.info("Generating document summary")
        document_summary = generate_document_summary(pages[0])
        
        # Step 4: Get active guideline and download its JSON
        logger.info("Retrieving active guideline")
        active_guideline = get_active_guideline_from_db()
        
        if not active_guideline:
            error_msg = "No active guideline found. Please activate a guideline before processing."
            logger.error(error_msg)
            update_dynamodb_status(
                case_id=case_id,
                status=STATUS_FAILED,
                metadata={"error": error_msg}
            )
            raise ValueError(error_msg)
        
        guideline_id = active_guideline['guideline_id']
        logger.info(f"Using active guideline: {guideline_id}")
        
        guidelines_s3_key = S3_PATH_GUIDELINE_JSON.format(guideline_id=guideline_id)
        guidelines_s3_path = f"s3://{S3_BUCKET_NAME}/{guidelines_s3_key}"
        
        guidelines_bytes = download_from_s3(guidelines_s3_path)
        guidelines = json.loads(guidelines_bytes.decode('utf-8'))
        guidelines_json = json.dumps(guidelines, indent=2)
        logger.info(f"Loaded {len(guidelines.get('guidelines', []))} guideline rules")
        
        # Step 5: Process all pages
        logger.info(f"Starting per-page redaction analysis for {total_pages} pages")
        all_redactions = process_pages_for_redactions(
            pages=pages,
            guidelines_json=guidelines_json,
            document_summary=document_summary
        )
        
        logger.info(f"Total redactions proposed: {len(all_redactions)}")
        
        # Step 6: Compile redaction proposals
        redaction_proposals = {
            "case_id": case_id,
            "total_pages": total_pages,
            "redactions": all_redactions
        }
        
        # Step 7: Upload to S3
        logger.info("Uploading redaction proposals to S3")
        upload_to_s3(
            s3_path=s3_paths["redaction_proposals"],
            data=json.dumps(redaction_proposals, indent=2).encode('utf-8')
        )
        
        # Step 8: Update status to REVIEW_READY
        update_dynamodb_status(
            case_id=case_id,
            status=STATUS_REVIEW_READY,
            metadata={
                "total_redactions_proposed": len(all_redactions),
                "redaction_proposals_path": s3_paths["redaction_proposals"],
                "document_summary": document_summary[:500],
                "guideline_id": guideline_id,
                "guideline_version": active_guideline.get('version', 'N/A'),
                "total_pages": total_pages
            }
        )
        
        logger.info(f"Successfully processed document for case: {case_id}")
        
        return {
            "total_redactions": len(all_redactions),
            "redaction_proposals_path": s3_paths["redaction_proposals"]
        }
        
    except Exception as e:
        logger.error(f"Error processing document for case {case_id}: {str(e)}", exc_info=True)
        raise


def attempt_json_repair(response_text: str, page_num: int) -> List[Dict[str, Any]] | None:
    """
    Attempt to salvage valid redaction objects from a malformed JSON response.
    
    Nova occasionally produces malformed JSON with missing key names or truncated
    objects. This function extracts any complete, valid redaction objects from
    the response rather than discarding the entire page result.
    
    Args:
        response_text: Raw response string from Nova that failed JSON parsing
        page_num: Page number for logging
        
    Returns:
        List of valid redaction objects recovered, or None if nothing recoverable
    """
    import re
    
    recovered = []
    
    # Strategy: extract individual {...} objects and attempt to parse each one.
    # This recovers all valid objects even if one in the middle is malformed.
    object_pattern = re.compile(r'\{[^{}]*\}', re.DOTALL)
    candidates = object_pattern.findall(response_text)
    
    for i, candidate in enumerate(candidates):
        try:
            obj = json.loads(candidate)
            # Only keep objects that have the minimum required fields
            # bbox is validated later — include partial objects so they
            # surface as warnings rather than being silently dropped here
            if "page" in obj and "text" in obj and "instance" in obj:
                recovered.append(obj)
        except json.JSONDecodeError:
            logger.debug(f"Page {page_num}: could not parse candidate object {i}: {candidate[:100]}")
            continue
    
    if recovered:
        logger.warning(
            f"Page {page_num}: JSON repair recovered {len(recovered)} of "
            f"~{len(candidates)} objects from malformed response"
        )
        return recovered
    
    logger.error(f"Page {page_num}: JSON repair failed, no valid objects recovered")
    return None