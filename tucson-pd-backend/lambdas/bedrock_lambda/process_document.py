"""
Process Document Module

This module handles the generation of redaction proposals using a split
OCR + semantic analysis architecture:

1. OCR (PyMuPDF/Tesseract) extracts all text with precise bounding boxes
2. Nova Pro performs semantic analysis to identify which text to redact
3. Bounding boxes are resolved from OCR output, not estimated by Nova

This replaces the previous single-pass approach where Nova Pro was responsible
for both identifying redactable text AND estimating spatial coordinates from
page images. By separating spatial precision (OCR) from semantic understanding
(Nova Pro), both tasks are handled by the tool best suited to each.

Flow:
1. Download unredacted PDF from S3
2. Render all pages to images using PyMuPDF (for document summary)
3. Run OCR on all pages to extract text with precise bounding boxes
4. Build cross-page entity index for consistency
5. Generate document summary from page 1 image
6. Get active guideline from DynamoDB and download its JSON from S3
7. Process each page with Nova Pro (semantic-only: which text to redact)
8. Resolve bounding boxes from OCR output
9. Compile all redactions into single JSON document
10. Upload redaction-proposals.json to S3
11. Update DynamoDB status to "REVIEW_READY"
"""

import os
import json
import base64
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Any, List, Tuple, Optional
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
from ocr_extraction import (
    extract_all_pages,
    build_entity_index,
    merge_adjacent_blocks,
    format_text_map_for_prompt,
    format_entity_index_for_prompt
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# DPI for page rendering — used for both image generation and OCR.
# 150 is sufficient for clear printed scans; increase to 200 for degraded scans.
PAGE_RENDER_DPI = 150

# Maximum number of concurrent Nova API calls. Bedrock has per-model
# throttling limits; 3–5 is safe for Nova Pro without hitting rate limits.
# Increase if your account has higher provisioned throughput.
MAX_NOVA_CONCURRENCY = 3


def render_pdf_pages(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """
    Render all pages of a PDF to PNG images using PyMuPDF.
    
    Images are still generated for the document summary step (which uses
    Nova Pro vision on page 1). Per-page redaction analysis now uses OCR
    text maps instead of images.
    
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
    page_map: Dict[str, Any],
    guidelines_json: str,
    document_summary: str,
    entity_index: Dict[str, List[Dict[str, Any]]]
) -> List[Dict[str, Any]]:
    """
    Send a page's OCR text map to Nova Pro for semantic redaction identification.

    Unlike the previous approach, Nova does NOT receive the page image or estimate
    bounding box coordinates. It receives the structured text map from OCR and
    identifies which text blocks should be redacted by referencing their IDs.

    Args:
        page_map: OCR text map from ocr_extraction.extract_text_from_page
        guidelines_json: JSON string of active redaction guidelines
        document_summary: Summary of full document for context
        entity_index: Cross-page entity index for consistency

    Returns:
        List of raw redaction decisions from Nova (before coordinate resolution):
        [
            {
                "page": 1,
                "text": "Clark Kent",
                "instance": 1,
                "rules": ["1"],
                "block_ids": ["p1_b2_l0_w3", "p1_b2_l0_w4"]
            }
        ]
    """
    page_num = page_map["page_num"]
    logger.info(f"Analyzing page {page_num} with Nova Pro (semantic-only)")

    start_time = time.time()

    # Format the OCR text map and entity index for the prompt
    text_map_str = format_text_map_for_prompt(page_map)
    entity_context_str = format_entity_index_for_prompt(entity_index, page_num)

    message = {
        "role": "user",
        "content": [
            {
                "text": f"Analyze page {page_num} for required redactions.\n\n"
                        f"PAGE TEXT MAP:\n{text_map_str}"
            }
        ]
    }

    system_prompts = get_prompt(
        "page_analysis",
        guidelines=guidelines_json,
        doc_summary=document_summary,
        page_number=page_num,
        entity_context=entity_context_str
    )

    response = converse_with_bedrock(
        model_id=get_id("page_analysis"),
        messages=[message],
        system_prompts=system_prompts,
        inference_config=get_config("page_analysis")
    )

    elapsed = time.time() - start_time
    logger.info(f"Nova Pro responded for page {page_num} in {elapsed:.1f}s")

    # Check for truncation
    stop_reason = response.get("stopReason")
    if stop_reason == "max_tokens":
        logger.error(
            f"Page {page_num}: Nova response truncated (max_tokens). "
            f"Results may be incomplete."
        )
    elif stop_reason not in ("end_turn", "stop_sequence", None):
        logger.warning(f"Page {page_num}: unexpected stopReason: {stop_reason}")

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

    # Validate required fields for the new format (block_ids instead of bbox)
    validated = []
    for i, redaction in enumerate(redactions):
        required_fields = ["page", "text", "instance", "rules", "block_ids"]
        missing = [f for f in required_fields if f not in redaction]
        if missing:
            logger.warning(
                f"Page {page_num}, redaction {i}: missing fields {missing}, skipping"
            )
            continue

        if not isinstance(redaction["block_ids"], list) or not redaction["block_ids"]:
            logger.warning(
                f"Page {page_num}, redaction {i} ('{redaction.get('text', 'unknown')}'): "
                f"block_ids must be a non-empty list, skipping"
            )
            continue

        validated.append(redaction)

    logger.info(
        f"Page {page_num}: {len(validated)} valid redaction decisions "
        f"(of {len(redactions)} proposed)"
    )
    return validated


def resolve_bounding_boxes(
    redactions: List[Dict[str, Any]],
    page_map: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    Resolve OCR-precise bounding boxes for Nova's redaction decisions.

    Takes Nova's semantic output (text + block_ids) and looks up the exact
    bounding box coordinates from the OCR text map. For multi-word spans,
    merges adjacent block bounding boxes into a single redaction rectangle.

    This is the key improvement: bounding boxes come from OCR (pixel-precise)
    rather than from Nova's spatial estimates.

    Args:
        redactions: List of redaction decisions from analyze_page_with_nova
        page_map: OCR text map for the same page

    Returns:
        List of redaction objects with resolved bbox_pts, in the same output
        format as the previous system for downstream compatibility:
        [
            {
                "page": 1,
                "text": "Clark Kent",
                "instance": 1,
                "rules": ["1"],
                "bbox_pts": {"x0": 74.2, "y0": 210.0, "x1": 129.5, "y1": 222.5}
            }
        ]
    """
    page_num = page_map["page_num"]
    resolved = []
    unresolved_count = 0

    for redaction in redactions:
        block_ids = redaction["block_ids"]

        try:
            merged = merge_adjacent_blocks(block_ids, page_map["text_blocks"])

            resolved.append({
                "page": redaction["page"],
                "text": redaction["text"],
                "instance": redaction["instance"],
                "rules": redaction["rules"],
                "bbox_pts": merged["bbox_pts"]
            })

        except ValueError as e:
            # Block ID not found — Nova may have hallucinated an ID or
            # referenced an OCR word that was filtered out.
            # Fall back to fuzzy text matching against OCR lines.
            logger.warning(
                f"Page {page_num}, redaction '{redaction.get('text', 'unknown')}': "
                f"block ID resolution failed ({e}). Attempting text-based fallback."
            )

            fallback_bbox = _fuzzy_text_match(
                redaction.get("text", ""),
                redaction.get("instance", 1),
                page_map
            )

            if fallback_bbox:
                resolved.append({
                    "page": redaction["page"],
                    "text": redaction["text"],
                    "instance": redaction["instance"],
                    "rules": redaction["rules"],
                    "bbox_pts": fallback_bbox
                })
                logger.info(
                    f"Page {page_num}: text-based fallback resolved "
                    f"'{redaction.get('text', 'unknown')}'"
                )
            else:
                unresolved_count += 1
                logger.warning(
                    f"Page {page_num}: could not resolve bbox for "
                    f"'{redaction.get('text', 'unknown')}' (instance "
                    f"{redaction.get('instance', '?')}), skipping"
                )

    if unresolved_count > 0:
        logger.warning(
            f"Page {page_num}: {unresolved_count} redactions could not be "
            f"resolved to bounding boxes"
        )

    logger.info(
        f"Page {page_num}: {len(resolved)} redactions resolved with OCR bounding boxes"
    )
    return resolved


def _fuzzy_text_match(
    target_text: str,
    instance: int,
    page_map: Dict[str, Any]
) -> Optional[Dict[str, float]]:
    """
    Fall back to matching redaction text against OCR lines when block IDs fail.

    Searches all lines on the page for text that contains the target string
    (case-insensitive). If found, returns the bounding box of the matching
    words within that line.

    This handles cases where Nova referenced invalid block IDs but correctly
    identified the text content to redact.

    Args:
        target_text: The text Nova wants to redact
        instance: Which occurrence to match (1-based)
        page_map: OCR text map for the page

    Returns:
        Bounding box dict if found, None otherwise
    """
    if not target_text.strip():
        return None

    target_lower = target_text.strip().lower()
    matches_found = 0

    for line in page_map["lines"]:
        line_lower = line["text"].lower()

        if target_lower in line_lower:
            matches_found += 1

            if matches_found == instance:
                # Find which words in this line contain the target text.
                # For exact matches, use the line bbox. For partial matches
                # within a longer line, try to narrow to the relevant words.
                matching_block_ids = _find_word_ids_for_substring(
                    target_text, line, page_map["text_blocks"]
                )

                if matching_block_ids:
                    try:
                        merged = merge_adjacent_blocks(
                            matching_block_ids, page_map["text_blocks"]
                        )
                        return merged["bbox_pts"]
                    except ValueError:
                        pass

                # If word-level matching fails, use the whole line bbox
                return line["bbox_pts"]

    return None


def _find_word_ids_for_substring(
    target_text: str,
    line: Dict[str, Any],
    text_blocks: List[Dict[str, Any]]
) -> List[str]:
    """
    Find the specific word IDs within a line that correspond to a target substring.

    Given "John Smith" and a line containing "Officer John Smith arrived",
    returns the block IDs for "John" and "Smith".

    Args:
        target_text: The substring to find
        line: Line dict from OCR containing word_ids
        text_blocks: Full list of text blocks for the page

    Returns:
        List of matching block IDs, or empty list if matching fails
    """
    target_words = target_text.strip().lower().split()
    if not target_words:
        return []

    # Get the actual word texts for each word_id in this line
    line_words = []
    for wid in line["word_ids"]:
        for block in text_blocks:
            if block["block_id"] == wid:
                line_words.append({"id": wid, "text": block["text"]})
                break

    # Sliding window search for the target word sequence
    for start_idx in range(len(line_words) - len(target_words) + 1):
        window = line_words[start_idx:start_idx + len(target_words)]
        window_texts = [w["text"].lower() for w in window]

        if window_texts == target_words:
            return [w["id"] for w in window]

    # Relaxed match: check if target words appear as substrings of line words
    # Handles cases like OCR joining punctuation to words
    for start_idx in range(len(line_words) - len(target_words) + 1):
        window = line_words[start_idx:start_idx + len(target_words)]
        all_match = True
        for tw, lw in zip(target_words, window):
            if tw not in lw["text"].lower():
                all_match = False
                break
        if all_match:
            return [w["id"] for w in window]

    return []


def process_pages_for_redactions(
    page_maps: List[Dict[str, Any]],
    guidelines_json: str,
    document_summary: str,
    entity_index: Dict[str, List[Dict[str, Any]]]
) -> List[Dict[str, Any]]:
    """
    Process all pages with parallel Nova calls, then resolve bounding boxes.

    Nova API calls are I/O-bound (network wait), so we use a thread pool to
    run multiple pages concurrently. This is the biggest performance win —
    a 15-page document goes from ~60s sequential to ~20s with 3 workers.

    Args:
        page_maps: List of OCR text maps from extract_all_pages
        guidelines_json: JSON string of active redaction guidelines
        document_summary: Summary of full document
        entity_index: Cross-page entity index

    Returns:
        List of all redaction objects across all pages, with resolved bbox_pts
    """
    total_pages = len(page_maps)
    logger.info(
        f"Processing {total_pages} pages with up to "
        f"{MAX_NOVA_CONCURRENCY} concurrent Nova calls"
    )

    # Step A: Run Nova semantic analysis in parallel
    nova_results = {}  # page_num -> list of nova decisions

    def _analyze_page(page_map):
        """Worker function for thread pool."""
        return (
            page_map["page_num"],
            analyze_page_with_nova(
                page_map=page_map,
                guidelines_json=guidelines_json,
                document_summary=document_summary,
                entity_index=entity_index
            )
        )

    with ThreadPoolExecutor(max_workers=MAX_NOVA_CONCURRENCY) as executor:
        futures = {
            executor.submit(_analyze_page, pm): pm["page_num"]
            for pm in page_maps
        }

        for future in as_completed(futures):
            page_num = futures[future]
            try:
                result_page_num, decisions = future.result()
                nova_results[result_page_num] = decisions
                logger.info(
                    f"Page {result_page_num}/{total_pages}: "
                    f"{len(decisions)} semantic decisions"
                )
            except Exception as e:
                logger.error(
                    f"Page {page_num}: Nova analysis failed: {e}",
                    exc_info=True
                )
                nova_results[page_num] = []

    # Step B: Resolve bounding boxes sequentially (fast, CPU-only)
    all_redactions = []
    for page_map in page_maps:
        page_num = page_map["page_num"]
        decisions = nova_results.get(page_num, [])

        if not decisions:
            continue

        resolved = resolve_bounding_boxes(decisions, page_map)
        logger.info(
            f"Page {page_num}: {len(decisions)} decisions → "
            f"{len(resolved)} resolved"
        )
        all_redactions.extend(resolved)

    return all_redactions


def process_document(case_id: str, s3_paths: Dict[str, str]) -> Dict[str, Any]:
    """
    Generate redaction proposals for a document using split OCR + semantic analysis.

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

        # Step 2: Render all pages to images (used for document summary)
        logger.info("Rendering PDF pages to images")
        pages = render_pdf_pages(unredacted_pdf_bytes)
        total_pages = len(pages)
        logger.info(f"Rendered {total_pages} pages")

        update_dynamodb_status(
            case_id=case_id,
            status=STATUS_PROCESSING,
            metadata={"stage": "extracting_text_ocr", "total_pages": total_pages}
        )

        # Step 3: Run OCR on all pages — extract text with precise bounding boxes
        logger.info("Running OCR extraction on all pages")
        page_maps = extract_all_pages(unredacted_pdf_bytes, render_dpi=PAGE_RENDER_DPI)
        total_words = sum(len(pm["text_blocks"]) for pm in page_maps)
        logger.info(f"OCR extracted {total_words} words across {total_pages} pages")

        # Step 4: Build cross-page entity index
        logger.info("Building cross-page entity index")
        entity_index = build_entity_index(page_maps)
        logger.info(f"Entity index contains {len(entity_index)} tracked entities")

        update_dynamodb_status(
            case_id=case_id,
            status=STATUS_PROCESSING,
            metadata={"stage": "analyzing_document", "total_pages": total_pages}
        )

        # Step 5: Generate document summary from page 1 image
        logger.info("Generating document summary")
        document_summary = generate_document_summary(pages[0])

        # Step 6: Get active guideline and download its JSON
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
        logger.info(f"Loaded {len(guidelines.get('rules', guidelines.get('guidelines', [])))} guideline rules")

        # Step 7: Process all pages — semantic analysis + bbox resolution
        logger.info(f"Starting per-page redaction analysis for {total_pages} pages")
        all_redactions = process_pages_for_redactions(
            page_maps=page_maps,
            guidelines_json=guidelines_json,
            document_summary=document_summary,
            entity_index=entity_index
        )

        logger.info(f"Total redactions proposed: {len(all_redactions)}")

        # Step 8: Compile redaction proposals
        redaction_proposals = {
            "case_id": case_id,
            "total_pages": total_pages,
            "redactions": all_redactions
        }

        # Step 9: Upload to S3
        logger.info("Uploading redaction proposals to S3")
        upload_to_s3(
            s3_path=s3_paths["redaction_proposals"],
            data=json.dumps(redaction_proposals, indent=2).encode('utf-8')
        )

        # Step 10: Update status to REVIEW_READY
        update_dynamodb_status(
            case_id=case_id,
            status=STATUS_REVIEW_READY,
            metadata={
                "total_redactions_proposed": len(all_redactions),
                "redaction_proposals_path": s3_paths["redaction_proposals"],
                "document_summary": document_summary[:500],
                "guideline_id": guideline_id,
                "guideline_version": active_guideline.get('version', 'N/A'),
                "total_pages": total_pages,
                "ocr_total_words": total_words,
                "cross_page_entities": len(entity_index)
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

    Updated for the new format: looks for block_ids instead of bbox.

    Args:
        response_text: Raw response string from Nova that failed JSON parsing
        page_num: Page number for logging

    Returns:
        List of valid redaction objects recovered, or None if nothing recoverable
    """
    recovered = []

    # Strategy: extract individual {...} objects that may contain nested arrays/objects.
    # Use a bracket-counting approach to handle block_ids arrays inside objects.
    objects = _extract_json_objects(response_text)

    for i, candidate in enumerate(objects):
        try:
            obj = json.loads(candidate)
            # Minimum required fields for the new format
            if "page" in obj and "text" in obj and "instance" in obj:
                # Ensure block_ids exists and is a list
                if "block_ids" not in obj:
                    logger.debug(
                        f"Page {page_num}: recovered object {i} missing block_ids, skipping"
                    )
                    continue
                recovered.append(obj)
        except json.JSONDecodeError:
            logger.debug(
                f"Page {page_num}: could not parse candidate object {i}: "
                f"{candidate[:100]}"
            )
            continue

    if recovered:
        logger.warning(
            f"Page {page_num}: JSON repair recovered {len(recovered)} of "
            f"~{len(objects)} objects from malformed response"
        )
        return recovered

    logger.error(f"Page {page_num}: JSON repair failed, no valid objects recovered")
    return None


def _extract_json_objects(text: str) -> List[str]:
    """
    Extract top-level JSON objects from a string using bracket counting.

    Handles nested structures (arrays inside objects) that the simple
    regex approach in the old code would miss.

    Args:
        text: Raw text potentially containing JSON objects

    Returns:
        List of extracted JSON object strings
    """
    objects = []
    depth = 0
    start = None

    for i, char in enumerate(text):
        if char == '{':
            if depth == 0:
                start = i
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0 and start is not None:
                objects.append(text[start:i + 1])
                start = None

    return objects