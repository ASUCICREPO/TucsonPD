"""
Guidelines Management Module

This module handles the complete lifecycle of redaction guidelines:
1. Admin uploads PDF guideline document
2. System converts PDF to JSON rules via Bedrock Lambda
3. Admin reviews and edits JSON
4. Admin activates guideline for use in redaction process
5. System uses active guideline for all redactions

Guidelines are stored in:
- DynamoDB: Metadata (guideline_id, version, status, paths, etc.)
- S3: PDF documents and converted JSON files
"""

import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime

from utils import (
    generate_case_id,
    get_current_timestamp,
    get_guidelines_item,
    put_guidelines_item,
    update_guidelines_item,
    query_all_guidelines,
    get_active_guideline_from_db,
    generate_presigned_post,
    generate_presigned_url,
    download_from_s3,
    upload_to_s3,
    invoke_bedrock_lambda,
    build_s3_path_for_guideline
)
from constants import (
    S3_BUCKET_NAME,
    PRESIGNED_URL_EXPIRATION
)

logger = logging.getLogger(__name__)


def create_guideline(
    admin_id: str,
    admin_name: str,
    description: str
) -> Dict[str, Any]:
    """
    Create a new guideline record and generate pre-signed URL for PDF upload
    
    Args:
        admin_id: Cognito user ID of admin
        admin_name: Display name of admin
        description: Description of this guideline version
        
    Returns:
        Dictionary containing guideline_id, upload_url, and metadata
        
    Raises:
        Exception: If DynamoDB or S3 operation fails
    """
    logger.info(f"Creating new guideline by admin: {admin_id}")
    
    try:
        # Generate unique guideline ID
        guideline_id = generate_case_id()
        timestamp = get_current_timestamp()
        
        # Generate version based on timestamp
        version = datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d_%H-%M-%S")
        
        # Build S3 paths
        pdf_s3_key = f"guidelines/documents/{guideline_id}.pdf"
        json_s3_key = f"guidelines/processed/{guideline_id}.json"
        
        # Create guideline item
        guideline_item = {
            'guideline_id': guideline_id,
            'version': version,
            'description': description,
            'uploaded_by': admin_id,
            'uploaded_by_name': admin_name,
            'created_at': timestamp,
            'updated_at': timestamp,
            'status': 'inactive',  # Can't be active until reviewed
            'processing_status': 'pending',  # pending -> processing -> completed/failed
            'pdf_s3_path': f"s3://{S3_BUCKET_NAME}/{pdf_s3_key}",
            'json_s3_path': f"s3://{S3_BUCKET_NAME}/{json_s3_key}",
            'error_info': {
                'last_error': None,
                'error_count': 0
            }
        }
        
        # Save to DynamoDB
        put_guidelines_item(guideline_item)
        
        # Generate pre-signed POST URL for PDF upload
        presigned_data = generate_presigned_post(
            bucket=S3_BUCKET_NAME,
            key=pdf_s3_key,
            expires_in=PRESIGNED_URL_EXPIRATION,
            content_type='application/pdf'
        )
        
        logger.info(f"Successfully created guideline: {guideline_id}")
        
        return {
            'guideline_id': guideline_id,
            'version': version,
            'upload_url': presigned_data['url'],
            'fields': presigned_data['fields']
        }
        
    except Exception as e:
        logger.error(f"Failed to create guideline: {str(e)}", exc_info=True)
        raise


def trigger_guideline_conversion(guideline_id: str) -> Dict[str, Any]:
    """
    Trigger Bedrock Lambda to convert PDF guidelines to JSON
    
    Args:
        guideline_id: Unique guideline identifier
        
    Returns:
        Dictionary with processing status
        
    Raises:
        ValueError: If guideline not found
        Exception: If Lambda invocation fails
    """
    logger.info(f"Triggering conversion for guideline: {guideline_id}")
    
    try:
        # Get guideline
        guideline = get_guidelines_item(guideline_id)
        if not guideline:
            raise ValueError(f"Guideline not found: {guideline_id}")
        
        # Verify PDF has been uploaded (check processing_status)
        if guideline['processing_status'] not in ['pending', 'failed']:
            logger.warning(f"Guideline {guideline_id} is already {guideline['processing_status']}")
        
        # Update status to processing
        update_guidelines_item(guideline_id, {
            'processing_status': 'processing'
        })
        
        # Prepare S3 paths for Bedrock Lambda
        s3_paths = {
            'pdf_path': guideline['pdf_s3_path'],
            'json_path': guideline['json_s3_path']
        }
        
        # Invoke Bedrock Lambda with action "convert_guidelines"
        invoke_bedrock_lambda(
            action='convert_guidelines',
            case_id=guideline_id,  # Reuse case_id parameter
            s3_paths=s3_paths
        )
        
        logger.info(f"Successfully triggered conversion for guideline: {guideline_id}")
        
        return {
            'processing_status': 'processing'
        }
        
    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Failed to trigger conversion: {str(e)}", exc_info=True)
        raise


def list_all_guidelines() -> Dict[str, Any]:
    """
    List all guidelines with metadata
    
    Returns:
        Dictionary containing active_guideline_id and list of all guidelines
        
    Raises:
        Exception: If DynamoDB query fails
    """
    logger.info("Listing all guidelines")
    
    try:
        # Query all guidelines
        guidelines = query_all_guidelines()
        
        # Find active guideline
        active_guideline_id = None
        for guideline in guidelines:
            if guideline.get('status') == 'active':
                active_guideline_id = guideline['guideline_id']
                break
        
        logger.info(f"Found {len(guidelines)} guidelines, active: {active_guideline_id}")
        
        return {
            'active_guideline_id': active_guideline_id,
            'guidelines': guidelines
        }
        
    except Exception as e:
        logger.error(f"Failed to list guidelines: {str(e)}", exc_info=True)
        raise


def get_active_guideline() -> Optional[Dict[str, Any]]:
    """
    Get the currently active guideline with full JSON content
    
    Returns:
        Active guideline with JSON content, or None if no active guideline
        
    Raises:
        Exception: If DynamoDB or S3 operation fails
    """
    logger.info("Retrieving active guideline")
    
    try:
        # Get active guideline metadata from DynamoDB
        active_guideline = get_active_guideline_from_db()
        
        if not active_guideline:
            logger.warning("No active guideline found")
            return None
        
        # Download JSON content from S3
        json_s3_path = active_guideline['json_s3_path']
        bucket = S3_BUCKET_NAME
        key = json_s3_path.replace(f"s3://{bucket}/", "")
        
        try:
            json_bytes = download_from_s3(bucket=bucket, key=key)
            guidelines_json = json.loads(json_bytes.decode('utf-8'))
            
            # Add JSON content to response
            active_guideline['guidelines_content'] = guidelines_json
            
        except Exception as e:
            logger.error(f"Failed to download active guideline JSON: {str(e)}")
            # Return metadata even if JSON download fails
            active_guideline['guidelines_content'] = None
            active_guideline['error'] = "Failed to load guidelines content"
        
        logger.info(f"Retrieved active guideline: {active_guideline['guideline_id']}")
        
        return active_guideline
        
    except Exception as e:
        logger.error(f"Failed to get active guideline: {str(e)}", exc_info=True)
        raise


def get_guideline_rules(guideline_id: str) -> Dict[str, Any]:
    """
    Get the extracted rules JSON for any completed or reviewed guideline.
    Used by the admin review screen to load rules for editing.

    Args:
        guideline_id: Unique guideline identifier

    Returns:
        Guideline metadata dict with guidelines_content attached

    Raises:
        ValueError: If guideline not found or rules not ready
        Exception: If S3 operation fails
    """
    logger.info(f"Retrieving rules for guideline: {guideline_id}")

    try:
        guideline = get_guidelines_item(guideline_id)
        if not guideline:
            raise ValueError(f"Guideline not found: {guideline_id}")

        if guideline['processing_status'] not in ('completed', 'reviewed'):
            raise ValueError(
                f"Guideline rules are not ready. Current processing status: {guideline['processing_status']}"
            )

        json_s3_path = guideline['json_s3_path']
        bucket = S3_BUCKET_NAME
        key = json_s3_path.replace(f"s3://{bucket}/", "")

        json_bytes = download_from_s3(bucket=bucket, key=key)
        guidelines_json = json.loads(json_bytes.decode('utf-8'))

        guideline['guidelines_content'] = guidelines_json

        logger.info(f"Retrieved rules for guideline: {guideline_id}")
        return guideline

    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Failed to get guideline rules for {guideline_id}: {str(e)}", exc_info=True)
        raise


def get_guideline_document_url(guideline_id: str) -> Dict[str, Any]:
    """
    Generate a pre-signed GET URL for downloading the original PDF of a guideline.
    Available for any guideline regardless of processing status, as long as the
    record exists (the PDF is uploaded before processing begins).

    Args:
        guideline_id: Unique guideline identifier

    Returns:
        Dictionary containing:
            - guideline_id: The guideline identifier
            - download_url: Pre-signed GET URL for the PDF (valid for PRESIGNED_URL_EXPIRATION seconds)
            - pdf_s3_path: The raw S3 path for reference
            - processing_status: Current processing status of the guideline

    Raises:
        ValueError: If guideline not found
        Exception: If S3 pre-signed URL generation fails
    """
    logger.info(f"Generating PDF download URL for guideline: {guideline_id}")

    try:
        guideline = get_guidelines_item(guideline_id)
        if not guideline:
            raise ValueError(f"Guideline not found: {guideline_id}")

        pdf_s3_path = guideline.get('pdf_s3_path')
        if not pdf_s3_path:
            raise ValueError(f"No PDF path found for guideline: {guideline_id}")

        # Strip the s3://bucket/ prefix to get the bare S3 key
        bucket = S3_BUCKET_NAME
        key = pdf_s3_path.replace(f"s3://{bucket}/", "")

        # Generate pre-signed GET URL
        download_url = generate_presigned_url(
            bucket=bucket,
            key=key,
            expires_in=PRESIGNED_URL_EXPIRATION,
            method='GET'
        )

        logger.info(f"Successfully generated PDF download URL for guideline: {guideline_id}")

        return {
            'guideline_id': guideline_id,
            'download_url': download_url,
            'pdf_s3_path': pdf_s3_path,
            'processing_status': guideline.get('processing_status'),
        }

    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Failed to generate PDF download URL for {guideline_id}: {str(e)}", exc_info=True)
        raise


def update_guideline_json(
    guideline_id: str,
    guidelines_json: Dict[str, Any],
    admin_id: str
) -> Dict[str, Any]:
    """
    Update guideline JSON after human review/editing
    
    Args:
        guideline_id: Unique guideline identifier
        guidelines_json: Updated guidelines JSON object
        admin_id: Admin who made the update
        
    Returns:
        Updated guideline metadata
        
    Raises:
        ValueError: If guideline not found or invalid JSON
        Exception: If update fails
    """
    logger.info(f"Updating guideline JSON: {guideline_id}")
    
    try:
        # Get guideline
        guideline = get_guidelines_item(guideline_id)
        if not guideline:
            raise ValueError(f"Guideline not found: {guideline_id}")
        
        # Validate JSON has required structure (basic validation)
        if 'guidelines' not in guidelines_json:
            raise ValueError("Guidelines JSON must contain 'guidelines' array")
        
        # Upload updated JSON to S3
        json_s3_path = guideline['json_s3_path']
        bucket = S3_BUCKET_NAME
        key = json_s3_path.replace(f"s3://{bucket}/", "")
        
        json_str = json.dumps(guidelines_json, indent=2)
        upload_to_s3(
            bucket=bucket,
            key=key,
            data=json_str.encode('utf-8'),
            content_type='application/json'
        )
        
        # Update metadata in DynamoDB
        timestamp = get_current_timestamp()
        update_guidelines_item(guideline_id, {
            'updated_at': timestamp,
            'updated_by': admin_id,
            'processing_status': 'reviewed'  # Human has reviewed and saved — ready to activate
        })
        
        # Get updated guideline
        updated_guideline = get_guidelines_item(guideline_id)
        
        logger.info(f"Successfully updated guideline JSON: {guideline_id}")
        
        return updated_guideline
        
    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Failed to update guideline JSON: {str(e)}", exc_info=True)
        raise


def activate_guideline(guideline_id: str, admin_id: str) -> Dict[str, Any]:
    """
    Set a guideline as active (deactivates all others)
    
    Args:
        guideline_id: Unique guideline identifier
        admin_id: Admin activating the guideline
        
    Returns:
        Activated guideline metadata
        
    Raises:
        ValueError: If guideline not found or not ready for activation
        Exception: If activation fails
    """
    logger.info(f"Activating guideline: {guideline_id}")
    
    try:
        # Get guideline
        guideline = get_guidelines_item(guideline_id)
        if not guideline:
            raise ValueError(f"Guideline not found: {guideline_id}")
        
        # Verify it's ready to be activated (must have been human-reviewed)
        if guideline['processing_status'] != 'reviewed':
            raise ValueError(
                f"Guideline must be reviewed by an admin before activation. "
                f"Current status: {guideline['processing_status']}"
            )
        
        # Deactivate all other guidelines
        all_guidelines = query_all_guidelines()
        for g in all_guidelines:
            if g.get('status') == 'active' and g['guideline_id'] != guideline_id:
                logger.info(f"Deactivating guideline: {g['guideline_id']}")
                update_guidelines_item(g['guideline_id'], {
                    'status': 'inactive'
                })
        
        # Activate this guideline
        timestamp = get_current_timestamp()
        update_guidelines_item(guideline_id, {
            'status': 'active',
            'activated_at': timestamp,
            'activated_by': admin_id
        })
        
        # Get updated guideline
        activated_guideline = get_guidelines_item(guideline_id)
        
        logger.info(f"Successfully activated guideline: {guideline_id}")
        
        return activated_guideline
        
    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Failed to activate guideline: {str(e)}", exc_info=True)
        raise


def delete_guideline(guideline_id: str) -> None:
    """
    Delete a guideline (cannot delete active guideline)
    
    Args:
        guideline_id: Unique guideline identifier
        
    Raises:
        ValueError: If guideline not found or is active
        Exception: If deletion fails
    """
    logger.info(f"Deleting guideline: {guideline_id}")
    
    try:
        # Get guideline
        guideline = get_guidelines_item(guideline_id)
        if not guideline:
            raise ValueError(f"Guideline not found: {guideline_id}")
        
        # Prevent deletion of active guideline
        if guideline.get('status') == 'active':
            raise ValueError("Cannot delete active guideline. Please activate another guideline first.")
        
        # Delete from DynamoDB
        from utils import delete_guidelines_item
        delete_guidelines_item(guideline_id)
        
        # Note: We're keeping S3 files for audit trail
        # In production, you might want to move them to an archive bucket
        # or delete them based on your retention policy
        
        logger.info(f"Successfully deleted guideline: {guideline_id}")
        
    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Failed to delete guideline: {str(e)}", exc_info=True)
        raise