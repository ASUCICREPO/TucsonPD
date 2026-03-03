"""
Pre-signed URLs Module

This module handles generation of pre-signed URLs for S3 uploads and downloads.
It provides secure, time-limited access to S3 objects without exposing credentials.
"""

import logging
from typing import Dict, Any

from utils import (
    generate_presigned_post,
    generate_presigned_url,
    get_s3_key_for_file_type
)
from constants import (
    S3_BUCKET_NAME,
    PRESIGNED_URL_EXPIRATION
)

logger = logging.getLogger(__name__)


def generate_upload_url(
    case_id: str,
    file_type: str,
    expires_in: int = PRESIGNED_URL_EXPIRATION
) -> Dict[str, Any]:
    """
    Generate a pre-signed POST URL for uploading files to S3
    
    Args:
        case_id: Unique case identifier
        file_type: Type of file being uploaded (intake_form, unredacted_doc, edited_redactions)
        expires_in: URL expiration time in seconds (default from constants)
        
    Returns:
        Dictionary containing:
            - url: Pre-signed POST URL
            - fields: Form fields to include in POST request
            - s3_path: Full S3 path for reference
        
    Raises:
        ValueError: If file_type is invalid
        Exception: If S3 operation fails
    """
    logger.info(f"Generating upload URL for case {case_id}, file type: {file_type}")
    
    # Validate file_type
    valid_upload_types = ['intake_form', 'unredacted_doc', 'edited_redactions']
    if file_type not in valid_upload_types:
        raise ValueError(f"Invalid file_type for upload: {file_type}. Must be one of {valid_upload_types}")
    
    try:
        # Get S3 key for this file type
        s3_key = get_s3_key_for_file_type(case_id, file_type)
        
        # Determine content type based on file type
        content_type = 'application/pdf' if file_type != 'edited_redactions' else 'application/json'
        
        # Generate pre-signed POST
        presigned_data = generate_presigned_post(
            bucket=S3_BUCKET_NAME,
            key=s3_key,
            expires_in=expires_in,
            content_type=content_type
        )
        
        # Build full S3 path for reference
        s3_path = f"s3://{S3_BUCKET_NAME}/{s3_key}"
        
        logger.info(f"Successfully generated upload URL for {s3_path}")
        
        return {
            'url': presigned_data['url'],
            'fields': presigned_data['fields'],
            's3_path': s3_path
        }
        
    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Failed to generate upload URL: {str(e)}", exc_info=True)
        raise


def generate_download_url(
    case_id: str,
    file_type: str,
    expires_in: int = PRESIGNED_URL_EXPIRATION
) -> str:
    """
    Generate a pre-signed GET URL for downloading files from S3
    
    Args:
        case_id: Unique case identifier
        file_type: Type of file to download (redaction_proposals, redacted_doc)
        expires_in: URL expiration time in seconds (default from constants)
        
    Returns:
        Pre-signed GET URL as string
        
    Raises:
        ValueError: If file_type is invalid
        Exception: If S3 operation fails
    """
    logger.info(f"Generating download URL for case {case_id}, file type: {file_type}")
    
    # Validate file_type
    valid_download_types = ['redaction_proposals', 'redacted_doc', 'unredacted_doc', 'intake_form', 'edited_redactions']
    if file_type not in valid_download_types:
        raise ValueError(f"Invalid file_type for download: {file_type}. Must be one of {valid_download_types}")
    
    try:
        # Get S3 key for this file type
        s3_key = get_s3_key_for_file_type(case_id, file_type)
        
        # Generate pre-signed GET URL
        download_url = generate_presigned_url(
            bucket=S3_BUCKET_NAME,
            key=s3_key,
            expires_in=expires_in,
            method='GET'
        )
        
        logger.info(f"Successfully generated download URL for s3://{S3_BUCKET_NAME}/{s3_key}")
        
        return download_url
        
    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Failed to generate download URL: {str(e)}", exc_info=True)
        raise