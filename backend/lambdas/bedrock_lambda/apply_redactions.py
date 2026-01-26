"""
Apply Redactions Module

This module handles the final step of applying approved redactions to the PDF.
It downloads the unredacted PDF and the edited redactions JSON, finds the exact
coordinates of each redaction using pdfplumber, then applies permanent black boxes
using PyMuPDF (fitz).

Flow:
1. Download unredacted PDF from S3
2. Download edited-redactions.json from S3
3. For each redaction, find exact coordinates using pdfplumber (instance tracking)
4. Apply black rectangles over coordinates using PyMuPDF
5. Upload redacted PDF to S3
6. Update DynamoDB status to "COMPLETED"
"""

import json
import logging
import tempfile
from typing import Dict, Any, List, Tuple
import pdfplumber
import fitz  # PyMuPDF

from utils import (
    download_from_s3,
    upload_to_s3,
    update_dynamodb_status
)
from constants import STATUS_APPLYING_REDACTIONS, STATUS_COMPLETED

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def apply_redactions(case_id: str, s3_paths: Dict[str, str]) -> Dict[str, Any]:
    """
    Apply approved redactions to the PDF
    
    Args:
        case_id: Unique case identifier
        s3_paths: Dictionary containing S3 paths for all relevant files
        
    Returns:
        Dictionary with processing results
        
    Raises:
        Exception: If any step fails
    """
    
    logger.info(f"Starting redaction application for case: {case_id}")
    
    # Update status to APPLYING_REDACTIONS
    update_dynamodb_status(
        case_id=case_id,
        status=STATUS_APPLYING_REDACTIONS,
        metadata={"stage": "starting_redaction_application"}
    )
    
    try:
        # Step 1: Download unredacted PDF
        logger.info("Downloading unredacted PDF from S3")
        unredacted_pdf_bytes = download_from_s3(s3_paths["unredacted_doc"])
        
        # Step 2: Download edited redactions JSON
        logger.info("Downloading edited redactions JSON from S3")
        redactions_json_bytes = download_from_s3(s3_paths["edited_redactions"])
        redactions_data = json.loads(redactions_json_bytes.decode('utf-8'))
        
        # Step 3: Find coordinates for all redactions
        logger.info(f"Finding coordinates for {len(redactions_data['redactions'])} redactions")
        redactions_with_coords = find_redaction_coordinates(
            unredacted_pdf_bytes,
            redactions_data['redactions']
        )
        
        # Step 4: Apply redactions to PDF
        logger.info("Applying redactions to PDF")
        redacted_pdf_bytes = apply_redactions_to_pdf(
            unredacted_pdf_bytes,
            redactions_with_coords
        )
        
        # Step 5: Upload redacted PDF to S3
        logger.info("Uploading redacted PDF to S3")
        upload_to_s3(
            s3_path=s3_paths["redacted_doc"],
            data=redacted_pdf_bytes
        )
        
        # Step 6: Update DynamoDB status to COMPLETED
        metadata = {
            "total_redactions_applied": len(redactions_with_coords),
            "redacted_doc_path": s3_paths["redacted_doc"]
        }
        
        update_dynamodb_status(
            case_id=case_id,
            status=STATUS_COMPLETED,
            metadata=metadata
        )
        
        logger.info(f"Successfully applied {len(redactions_with_coords)} redactions for case: {case_id}")
        
        return {
            "redactions_applied": len(redactions_with_coords),
            "redacted_pdf_path": s3_paths["redacted_doc"]
        }
        
    except Exception as e:
        logger.error(f"Error applying redactions for case {case_id}: {str(e)}", exc_info=True)
        raise


def find_redaction_coordinates(
    pdf_bytes: bytes,
    redactions: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Find exact coordinates for each redaction using pdfplumber
    
    Args:
        pdf_bytes: Raw PDF file bytes
        redactions: List of redaction objects with page, text, instance
        
    Returns:
        List of redactions with added coordinate information
        
    Raises:
        ValueError: If text instance cannot be found on specified page
    """
    
    redactions_with_coords = []
    
    # Write PDF to temporary file for pdfplumber
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_pdf:
        temp_pdf.write(pdf_bytes)
        temp_pdf_path = temp_pdf.name
    
    try:
        with pdfplumber.open(temp_pdf_path) as pdf:
            for redaction in redactions:
                page_num = redaction['page']
                text_to_find = redaction['text']
                instance_num = redaction['instance']
                
                logger.info(f"Finding coordinates for '{text_to_find}' (instance {instance_num}) on page {page_num}")
                
                # Get the page (pdfplumber uses 0-based indexing)
                page = pdf.pages[page_num - 1]
                
                # Extract all words from the page
                words = page.extract_words()
                
                # Find all instances of the text
                matching_words = find_text_instances(words, text_to_find)
                
                if len(matching_words) < instance_num:
                    error_msg = f"Could not find instance {instance_num} of '{text_to_find}' on page {page_num}. Found {len(matching_words)} instances."
                    logger.error(error_msg)
                    raise ValueError(error_msg)
                
                # Get the specific instance (1-based to 0-based index)
                target_word = matching_words[instance_num - 1]
                
                # Add coordinates to redaction
                redaction_with_coords = redaction.copy()
                redaction_with_coords['coordinates'] = {
                    'x0': target_word['x0'],
                    'y0': target_word['y0'],
                    'x1': target_word['x1'],
                    'y1': target_word['y1']
                }
                
                redactions_with_coords.append(redaction_with_coords)
                logger.info(f"Found coordinates: {redaction_with_coords['coordinates']}")
        
        return redactions_with_coords
        
    finally:
        # Clean up temporary file
        import os
        os.unlink(temp_pdf_path)


def find_text_instances(words: List[Dict], text_to_find: str) -> List[Dict]:
    """
    Find all instances of text in word list
    
    Handles both single-word matches and multi-word phrases
    
    Args:
        words: List of word dictionaries from pdfplumber
        text_to_find: Text to search for
        
    Returns:
        List of matching word bounding boxes
    """
    
    matches = []
    
    # Check if searching for multi-word phrase
    if ' ' in text_to_find:
        # Multi-word matching - combine consecutive words
        search_words = text_to_find.split()
        
        for i in range(len(words) - len(search_words) + 1):
            # Check if consecutive words match
            consecutive_text = ' '.join(word['text'] for word in words[i:i+len(search_words)])
            
            if consecutive_text == text_to_find:
                # Calculate combined bounding box
                combined_bbox = {
                    'x0': words[i]['x0'],
                    'y0': min(word['y0'] for word in words[i:i+len(search_words)]),
                    'x1': words[i+len(search_words)-1]['x1'],
                    'y1': max(word['y1'] for word in words[i:i+len(search_words)]),
                    'text': text_to_find
                }
                matches.append(combined_bbox)
    else:
        # Single word matching
        matches = [word for word in words if word['text'] == text_to_find]
    
    return matches


def apply_redactions_to_pdf(
    pdf_bytes: bytes,
    redactions: List[Dict[str, Any]]
) -> bytes:
    """
    Apply black rectangles over redaction coordinates using PyMuPDF
    
    Args:
        pdf_bytes: Raw PDF file bytes
        redactions: List of redactions with coordinates
        
    Returns:
        Redacted PDF as bytes
    """
    
    # Open PDF with PyMuPDF
    pdf_document = fitz.open(stream=pdf_bytes, filetype="pdf")
    
    try:
        # Group redactions by page for efficiency
        redactions_by_page = {}
        for redaction in redactions:
            page_num = redaction['page']
            if page_num not in redactions_by_page:
                redactions_by_page[page_num] = []
            redactions_by_page[page_num].append(redaction)
        
        # Apply redactions page by page
        for page_num, page_redactions in redactions_by_page.items():
            logger.info(f"Applying {len(page_redactions)} redactions to page {page_num}")
            
            # Get the page (PyMuPDF uses 0-based indexing)
            page = pdf_document[page_num - 1]
            
            for redaction in page_redactions:
                coords = redaction['coordinates']
                
                # Create rectangle for redaction
                # PyMuPDF uses (x0, y0, x1, y1) format
                rect = fitz.Rect(coords['x0'], coords['y0'], coords['x1'], coords['y1'])
                
                # Add redaction annotation (permanent black box)
                page.add_redact_annot(rect)
            
            # Apply all redactions on this page
            page.apply_redactions()
            logger.info(f"Applied redactions to page {page_num}")
        
        # Save to bytes
        redacted_pdf_bytes = pdf_document.tobytes()
        
        return redacted_pdf_bytes
        
    finally:
        pdf_document.close()