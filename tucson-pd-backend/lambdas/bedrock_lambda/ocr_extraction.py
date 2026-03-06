"""
OCR Extraction Module

This module handles text extraction from scanned PDF page images using PyMuPDF's
built-in OCR (Tesseract). It produces a structured text map for each page with
precise bounding box coordinates in PDF points, which serves as the spatial
source of truth for the redaction pipeline.

The extracted text blocks are used downstream in two ways:
1. Fed to Nova Pro as a structured text inventory for semantic redaction decisions
2. Used to resolve exact bounding box coordinates after Nova identifies what to redact

This replaces the previous approach where Nova Pro was responsible for both
identifying redactable text AND estimating its spatial coordinates from the page
image. By separating OCR (spatial precision) from semantic analysis (guideline
matching), both tasks are performed by the tool best suited to each.

Output Structure (per page):
{
    "page_num": 1,
    "text_blocks": [
        {
            "block_id": "p1_b0_l0_w0",
            "text": "POLICE",
            "bbox_pts": {"x0": 234.5, "y0": 72.0, "x1": 298.3, "y1": 84.0},
            "confidence": 95.2,
            "block_index": 0,
            "line_index": 0,
            "word_index": 0
        },
        ...
    ],
    "lines": [
        {
            "line_id": "p1_b0_l0",
            "text": "POLICE DEPARTMENT INCIDENT REPORT",
            "bbox_pts": {"x0": 234.5, "y0": 72.0, "x1": 512.1, "y1": 84.0},
            "word_ids": ["p1_b0_l0_w0", "p1_b0_l0_w1", "p1_b0_l0_w2", "p1_b0_l0_w3"]
        },
        ...
    ],
    "full_text": "POLICE DEPARTMENT INCIDENT REPORT\\nCase Number: 2024-00123\\n..."
}

ID scheme: p{page}_b{block}_l{line}_w{word} — hierarchical, stable, and
    directly references OCR structure for debugging.
"""

import logging
import re
from typing import Dict, Any, List, Optional, Set, Tuple

import fitz  # PyMuPDF

from constants import OCR_MIN_CONFIDENCE, OCR_RENDER_DPI
import constants  # Configures logging

logger = logging.getLogger(__name__)

# Re-export for use as default parameter values
MIN_OCR_CONFIDENCE = OCR_MIN_CONFIDENCE
DEFAULT_RENDER_DPI = OCR_RENDER_DPI


def extract_text_from_page(
    pdf_bytes: bytes,
    page_num: int,
    render_dpi: int = DEFAULT_RENDER_DPI
) -> Dict[str, Any]:
    """
    Extract all text from a single scanned PDF page using PyMuPDF OCR.

    Opens the PDF, runs OCR on the specified page, and returns a structured
    text map with word-level bounding boxes in PDF point coordinates.

    Args:
        pdf_bytes: Raw PDF file bytes
        page_num: 1-based page number to extract
        render_dpi: DPI used for page rendering (must match render_pdf_pages)

    Returns:
        Page text map dictionary (see module docstring for structure)

    Raises:
        ValueError: If page_num is out of range
        RuntimeError: If OCR fails entirely for the page
    """
    pdf_document = fitz.open(stream=pdf_bytes, filetype="pdf")

    try:
        total_pages = len(pdf_document)
        if page_num < 1 or page_num > total_pages:
            raise ValueError(
                f"Page {page_num} out of range (document has {total_pages} pages)"
            )

        page = pdf_document[page_num - 1]

        # get_text("dict") with OCR returns structured block/line/span/char data.
        # For scanned pages with no text layer, we need flags=fitz.TEXT_PRESERVE_WHITESPACE
        # and the textpage from OCR.
        #
        # PyMuPDF's get_text("words") with OCR is the most direct path:
        # it returns (x0, y0, x1, y1, "word", block_no, line_no, word_no) tuples
        # with coordinates already in PDF points.
        tp = page.get_textpage_ocr(
            dpi=render_dpi,
            full=True  # OCR the entire page, not just image regions
        )

        # Extract word-level data: each entry is
        # (x0, y0, x1, y1, "text", block_idx, line_idx, word_idx)
        raw_words = page.get_text("words", textpage=tp)

        if not raw_words:
            logger.warning(f"Page {page_num}: OCR returned no words")
            return _empty_page_result(page_num)

        logger.info(f"Page {page_num}: OCR extracted {len(raw_words)} raw words")

        # Build structured text blocks with IDs
        text_blocks = []
        lines_dict = {}  # keyed by (block_idx, line_idx) to group words into lines

        for word_tuple in raw_words:
            x0, y0, x1, y1, text, block_idx, line_idx, word_idx = word_tuple

            # Skip empty or whitespace-only words
            if not text.strip():
                continue

            # Build hierarchical ID
            block_id = f"p{page_num}_b{block_idx}_l{line_idx}_w{word_idx}"
            line_key = (block_idx, line_idx)
            line_id = f"p{page_num}_b{block_idx}_l{line_idx}"

            word_entry = {
                "block_id": block_id,
                "text": text.strip(),
                "bbox_pts": {
                    "x0": round(x0, 2),
                    "y0": round(y0, 2),
                    "x1": round(x1, 2),
                    "y1": round(y1, 2)
                },
                "block_index": block_idx,
                "line_index": line_idx,
                "word_index": word_idx
            }

            text_blocks.append(word_entry)

            # Accumulate words into lines
            if line_key not in lines_dict:
                lines_dict[line_key] = {
                    "line_id": line_id,
                    "words": [],
                    "word_ids": [],
                    "bbox_pts": {
                        "x0": round(x0, 2),
                        "y0": round(y0, 2),
                        "x1": round(x1, 2),
                        "y1": round(y1, 2)
                    }
                }

            line_entry = lines_dict[line_key]
            line_entry["words"].append(text.strip())
            line_entry["word_ids"].append(block_id)

            # Expand line bounding box to encompass this word
            line_entry["bbox_pts"]["x0"] = round(
                min(line_entry["bbox_pts"]["x0"], x0), 2
            )
            line_entry["bbox_pts"]["y0"] = round(
                min(line_entry["bbox_pts"]["y0"], y0), 2
            )
            line_entry["bbox_pts"]["x1"] = round(
                max(line_entry["bbox_pts"]["x1"], x1), 2
            )
            line_entry["bbox_pts"]["y1"] = round(
                max(line_entry["bbox_pts"]["y1"], y1), 2
            )

        # Finalize lines: join word texts into line text, sort by reading order
        lines = []
        for line_key in sorted(lines_dict.keys()):
            line_entry = lines_dict[line_key]
            line_entry["text"] = " ".join(line_entry["words"])
            del line_entry["words"]  # Don't need the temporary list in output
            lines.append(line_entry)

        # Build full page text (lines joined by newlines, blocks separated by double newlines)
        full_text = _build_full_text(lines, lines_dict)

        logger.info(
            f"Page {page_num}: {len(text_blocks)} words in "
            f"{len(lines)} lines extracted"
        )

        return {
            "page_num": page_num,
            "text_blocks": text_blocks,
            "lines": lines,
            "full_text": full_text
        }

    finally:
        pdf_document.close()


def extract_all_pages(
    pdf_bytes: bytes,
    render_dpi: int = DEFAULT_RENDER_DPI
) -> List[Dict[str, Any]]:
    """
    Extract text from all pages of a scanned PDF.

    Opens the PDF once and processes all pages in a single pass, avoiding
    the overhead of reopening the document for each page.

    Args:
        pdf_bytes: Raw PDF file bytes
        render_dpi: DPI used for page rendering

    Returns:
        List of page text maps, one per page, ordered by page number
    """
    pdf_document = fitz.open(stream=pdf_bytes, filetype="pdf")
    total_pages = len(pdf_document)

    logger.info(f"Starting OCR extraction for {total_pages} pages at {render_dpi} DPI")

    page_maps = []
    try:
        for page_index in range(total_pages):
            page_num = page_index + 1
            page = pdf_document[page_index]

            tp = page.get_textpage_ocr(dpi=render_dpi, full=True)
            raw_words = page.get_text("words", textpage=tp)

            if not raw_words:
                logger.warning(f"Page {page_num}: OCR returned no words")
                page_maps.append(_empty_page_result(page_num))
                continue

            # Build structured text blocks with IDs
            text_blocks = []
            lines_dict = {}

            for word_tuple in raw_words:
                x0, y0, x1, y1, text, block_idx, line_idx, word_idx = word_tuple

                if not text.strip():
                    continue

                block_id = f"p{page_num}_b{block_idx}_l{line_idx}_w{word_idx}"
                line_key = (block_idx, line_idx)
                line_id = f"p{page_num}_b{block_idx}_l{line_idx}"

                word_entry = {
                    "block_id": block_id,
                    "text": text.strip(),
                    "bbox_pts": {
                        "x0": round(x0, 2),
                        "y0": round(y0, 2),
                        "x1": round(x1, 2),
                        "y1": round(y1, 2)
                    },
                    "block_index": block_idx,
                    "line_index": line_idx,
                    "word_index": word_idx
                }

                text_blocks.append(word_entry)

                if line_key not in lines_dict:
                    lines_dict[line_key] = {
                        "line_id": line_id,
                        "words": [],
                        "word_ids": [],
                        "bbox_pts": {
                            "x0": round(x0, 2),
                            "y0": round(y0, 2),
                            "x1": round(x1, 2),
                            "y1": round(y1, 2)
                        }
                    }

                line_entry = lines_dict[line_key]
                line_entry["words"].append(text.strip())
                line_entry["word_ids"].append(block_id)

                line_entry["bbox_pts"]["x0"] = round(
                    min(line_entry["bbox_pts"]["x0"], x0), 2
                )
                line_entry["bbox_pts"]["y0"] = round(
                    min(line_entry["bbox_pts"]["y0"], y0), 2
                )
                line_entry["bbox_pts"]["x1"] = round(
                    max(line_entry["bbox_pts"]["x1"], x1), 2
                )
                line_entry["bbox_pts"]["y1"] = round(
                    max(line_entry["bbox_pts"]["y1"], y1), 2
                )

            # Finalize lines
            lines = []
            for lk in sorted(lines_dict.keys()):
                le = lines_dict[lk]
                le["text"] = " ".join(le["words"])
                del le["words"]
                lines.append(le)

            full_text = _build_full_text(lines, lines_dict)

            page_maps.append({
                "page_num": page_num,
                "text_blocks": text_blocks,
                "lines": lines,
                "full_text": full_text
            })

            logger.info(f"OCR page {page_num}/{total_pages}: {len(text_blocks)} words")

    finally:
        pdf_document.close()

    total_words = sum(len(pm["text_blocks"]) for pm in page_maps)
    logger.info(f"OCR complete: {total_words} words across {total_pages} pages")

    return page_maps


def build_entity_index(page_maps: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Build a cross-page index of text entities that appear across the document.

    Scans all OCR output to find recurring text patterns — names, numbers,
    addresses, etc. — that appear on multiple pages. This gives Nova Pro
    cross-page awareness so it can make consistent redaction decisions.

    The index maps normalized text strings to all their occurrences with
    page numbers and block IDs, allowing the prompt to say "this text also
    appears on pages X, Y, Z" for each candidate.

    Args:
        page_maps: List of page text maps from extract_all_pages

    Returns:
        Dictionary mapping normalized text strings to lists of occurrences:
        {
            "john smith": [
                {"page": 1, "block_ids": ["p1_b2_l0_w3", "p1_b2_l0_w4"], "text": "John Smith"},
                {"page": 5, "block_ids": ["p5_b1_l2_w0", "p5_b1_l2_w1"], "text": "JOHN SMITH"}
            ],
            "555-0123": [
                {"page": 1, "block_ids": ["p1_b3_l1_w2"], "text": "555-0123"}
            ]
        }
    """
    logger.info("Building cross-page entity index")

    # First pass: collect all multi-word sequences (bigrams and trigrams)
    # from each line, plus individual words that look like PII patterns
    entity_occurrences: Dict[str, List[Dict[str, Any]]] = {}

    for page_map in page_maps:
        page_num = page_map["page_num"]

        for line in page_map["lines"]:
            words = []
            word_ids = []

            # Pair up word texts with their IDs from the line
            for i, word_id in enumerate(line["word_ids"]):
                # Find the matching text block
                block = _find_block_by_id(page_map["text_blocks"], word_id)
                if block:
                    words.append(block["text"])
                    word_ids.append(word_id)

            # Extract individual words that match PII patterns
            for i, word in enumerate(words):
                if _looks_like_pii_token(word):
                    _add_occurrence(
                        entity_occurrences,
                        word,
                        page_num,
                        [word_ids[i]]
                    )

            # Extract bigrams (two consecutive words — catches "John Smith" style names)
            for i in range(len(words) - 1):
                bigram = f"{words[i]} {words[i+1]}"
                if _looks_like_name_or_identifier(bigram):
                    _add_occurrence(
                        entity_occurrences,
                        bigram,
                        page_num,
                        [word_ids[i], word_ids[i+1]]
                    )

            # Extract trigrams (three consecutive words — catches "Mary Jane Watson")
            for i in range(len(words) - 2):
                trigram = f"{words[i]} {words[i+1]} {words[i+2]}"
                if _looks_like_name_or_identifier(trigram):
                    _add_occurrence(
                        entity_occurrences,
                        trigram,
                        page_num,
                        [word_ids[i], word_ids[i+1], word_ids[i+2]]
                    )

    # Filter to entities that appear on more than one page OR match strong PII patterns.
    # Single-page, non-PII entities aren't useful for cross-page consistency.
    cross_page_entities = {}
    for normalized_text, occurrences in entity_occurrences.items():
        pages_seen = set(occ["page"] for occ in occurrences)
        is_strong_pii = _is_strong_pii_pattern(normalized_text)

        if len(pages_seen) > 1 or is_strong_pii:
            cross_page_entities[normalized_text] = occurrences

    logger.info(
        f"Entity index built: {len(cross_page_entities)} cross-page/PII entities "
        f"from {len(entity_occurrences)} total candidates"
    )

    return cross_page_entities


def merge_adjacent_blocks(
    block_ids: List[str],
    text_blocks: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Merge multiple adjacent text blocks into a single bounding box.

    Used when Nova flags a multi-word span for redaction (e.g., "John Smith"
    might be two separate OCR words). Computes the union bounding box that
    covers all specified blocks.

    Args:
        block_ids: List of block IDs to merge
        text_blocks: Full list of text blocks for the page

    Returns:
        Merged result with combined text and union bounding box:
        {
            "text": "John Smith",
            "bbox_pts": {"x0": ..., "y0": ..., "x1": ..., "y1": ...},
            "block_ids": ["p1_b2_l0_w3", "p1_b2_l0_w4"]
        }

    Raises:
        ValueError: If any block_id is not found
    """
    if not block_ids:
        raise ValueError("block_ids cannot be empty")

    blocks = []
    for bid in block_ids:
        block = _find_block_by_id(text_blocks, bid)
        if block is None:
            raise ValueError(f"Block ID not found: {bid}")
        blocks.append(block)

    # Sort by reading order (top-to-bottom, left-to-right)
    blocks.sort(key=lambda b: (b["bbox_pts"]["y0"], b["bbox_pts"]["x0"]))

    merged_text = " ".join(b["text"] for b in blocks)
    merged_bbox = {
        "x0": round(min(b["bbox_pts"]["x0"] for b in blocks), 2),
        "y0": round(min(b["bbox_pts"]["y0"] for b in blocks), 2),
        "x1": round(max(b["bbox_pts"]["x1"] for b in blocks), 2),
        "y1": round(max(b["bbox_pts"]["y1"] for b in blocks), 2)
    }

    return {
        "text": merged_text,
        "bbox_pts": merged_bbox,
        "block_ids": block_ids
    }


def format_text_map_for_prompt(page_map: Dict[str, Any]) -> str:
    """
    Format a page's OCR text map into a compact string representation
    suitable for inclusion in the Nova Pro prompt.

    Uses a line-based format where each line shows its ID, text content,
    and the IDs of its constituent words. This gives Nova enough structure
    to reference specific words by ID without overwhelming the context window.

    Args:
        page_map: Page text map from extract_text_from_page

    Returns:
        Formatted string for prompt injection, e.g.:
        LINE p1_b0_l0: "POLICE DEPARTMENT INCIDENT REPORT" [words: p1_b0_l0_w0, p1_b0_l0_w1, ...]
        LINE p1_b1_l0: "Case Number: 2024-00123" [words: p1_b1_l0_w0, p1_b1_l0_w1, ...]
    """
    if not page_map["lines"]:
        return "(No text detected on this page)"

    formatted_lines = []
    for line in page_map["lines"]:
        word_ids_str = ", ".join(line["word_ids"])
        formatted_lines.append(
            f'LINE {line["line_id"]}: "{line["text"]}" '
            f'[words: {word_ids_str}]'
        )

    return "\n".join(formatted_lines)


def format_entity_index_for_prompt(
    entity_index: Dict[str, List[Dict[str, Any]]],
    current_page: int
) -> str:
    """
    Format the cross-page entity index for inclusion in the Nova Pro prompt.

    Filters to entities relevant to the current page (i.e., entities that
    appear on this page AND at least one other page), and formats them to
    show where else each entity appears.

    Args:
        entity_index: Full entity index from build_entity_index
        current_page: Page number currently being analyzed

    Returns:
        Formatted string for prompt injection, e.g.:
        CROSS-PAGE ENTITY: "John Smith" — also appears on pages: 1, 5, 12
        CROSS-PAGE ENTITY: "555-0123" — also appears on pages: 1, 3
    """
    if not entity_index:
        return "(No cross-page entities detected)"

    relevant_entries = []

    for normalized_text, occurrences in entity_index.items():
        pages_with_entity = set(occ["page"] for occ in occurrences)

        if current_page in pages_with_entity:
            other_pages = sorted(pages_with_entity - {current_page})
            # Use the original-case version from the first occurrence
            display_text = occurrences[0]["text"]

            if other_pages:
                pages_str = ", ".join(str(p) for p in other_pages)
                relevant_entries.append(
                    f'CROSS-PAGE ENTITY: "{display_text}" — also appears on pages: {pages_str}'
                )
            else:
                # Entity only on this page but matched a strong PII pattern
                relevant_entries.append(
                    f'PII ENTITY: "{display_text}" — detected on this page'
                )

    if not relevant_entries:
        return "(No cross-page entities on this page)"

    return "\n".join(relevant_entries)


# ============================================================================
# PRIVATE HELPER FUNCTIONS
# ============================================================================

def _empty_page_result(page_num: int) -> Dict[str, Any]:
    """Return an empty text map for a page with no OCR results."""
    return {
        "page_num": page_num,
        "text_blocks": [],
        "lines": [],
        "full_text": ""
    }


def _find_block_by_id(
    text_blocks: List[Dict[str, Any]],
    block_id: str
) -> Optional[Dict[str, Any]]:
    """Find a text block by its ID. Returns None if not found."""
    for block in text_blocks:
        if block["block_id"] == block_id:
            return block
    return None


def _build_full_text(
    lines: List[Dict[str, Any]],
    lines_dict: Dict[Tuple[int, int], Dict[str, Any]]
) -> str:
    """
    Build full page text from lines, inserting paragraph breaks between
    blocks (groups of lines from the same OCR block).
    """
    if not lines:
        return ""

    parts = []
    prev_block_idx = None

    for line in lines:
        # Extract block index from line_id: "p1_b{block}_l{line}"
        line_id = line["line_id"]
        block_idx_match = re.search(r'_b(\d+)_', line_id)
        block_idx = int(block_idx_match.group(1)) if block_idx_match else 0

        if prev_block_idx is not None and block_idx != prev_block_idx:
            parts.append("")  # Empty string produces double newline when joined

        parts.append(line["text"])
        prev_block_idx = block_idx

    return "\n".join(parts)


def _add_occurrence(
    entity_occurrences: Dict[str, List[Dict[str, Any]]],
    text: str,
    page_num: int,
    block_ids: List[str]
) -> None:
    """Add an entity occurrence to the index."""
    normalized = text.strip().lower()
    if not normalized:
        return

    if normalized not in entity_occurrences:
        entity_occurrences[normalized] = []

    entity_occurrences[normalized].append({
        "page": page_num,
        "block_ids": block_ids,
        "text": text.strip()  # Preserve original case
    })


def _looks_like_pii_token(word: str) -> bool:
    """
    Check if a single word looks like a PII token worth tracking.

    Matches patterns like phone numbers, SSNs, dates of birth,
    driver's license numbers, and other numeric identifiers.
    """
    stripped = word.strip()
    if not stripped:
        return False

    # Phone number fragments: 555-0123, (555), 5550123
    if re.match(r'^[\d\(\)\-\.]{7,}$', stripped):
        return True

    # SSN pattern: 123-45-6789
    if re.match(r'^\d{3}-\d{2}-\d{4}$', stripped):
        return True

    # Date pattern: MM/DD/YYYY, MM-DD-YYYY
    if re.match(r'^\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}$', stripped):
        return True

    # Long numeric strings (IDs, account numbers): 6+ digits
    if re.match(r'^\d{6,}$', stripped):
        return True

    return False


def _looks_like_name_or_identifier(phrase: str) -> bool:
    """
    Check if a multi-word phrase looks like a name or identifier worth tracking.

    Uses capitalization patterns to identify likely proper nouns (names).
    This is a heuristic — it will have false positives, which is fine because
    the entity index is used for cross-page consistency hints, not as a
    redaction decision.
    """
    words = phrase.strip().split()
    if not words:
        return False

    # All words capitalized (Title Case or ALL CAPS) — likely a proper noun/name
    # Exclude very short words that are often capitalized in forms (A, I, OR, etc.)
    significant_words = [w for w in words if len(w) > 1]
    if not significant_words:
        return False

    all_capitalized = all(
        w[0].isupper() for w in significant_words
    )

    if all_capitalized:
        # Exclude common non-name capitalized phrases
        lowered = phrase.lower()
        non_name_phrases = {
            "police department", "incident report", "case number",
            "report number", "offense code", "date of", "page of",
            "department of", "state of", "county of", "city of",
            "united states", "the following", "see attached",
        }
        return lowered not in non_name_phrases

    return False


def _is_strong_pii_pattern(text: str) -> bool:
    """
    Check if a text string matches a strong PII pattern that should be
    tracked even if it only appears on one page.

    These are patterns that are almost certainly sensitive regardless of
    context: SSNs, phone numbers, dates that could be DOBs, etc.
    """
    stripped = text.strip()

    # SSN: 123-45-6789
    if re.match(r'^\d{3}-\d{2}-\d{4}$', stripped):
        return True

    # Phone: (555) 555-5555 or 555-555-5555 or similar
    if re.match(r'^[\(\d][\d\(\)\-\.\s]{9,}$', stripped):
        return True

    # Date: could be DOB
    if re.match(r'^\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}$', stripped):
        return True

    return False


logger.info("OCR extraction module loaded successfully")