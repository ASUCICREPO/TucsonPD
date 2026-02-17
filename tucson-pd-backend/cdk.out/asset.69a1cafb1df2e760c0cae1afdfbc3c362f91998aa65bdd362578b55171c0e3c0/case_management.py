"""
Case Management Module

This module handles all case CRUD operations in DynamoDB.
It manages the lifecycle of redaction cases from creation through completion.
"""

import json
import logging
from typing import Dict, Any, List, Optional

from utils import (
    generate_case_id,
    get_current_timestamp,
    get_dynamodb_item,
    put_dynamodb_item,
    update_dynamodb_item,
    query_dynamodb_by_index,
    invoke_bedrock_lambda,
    build_s3_path
)
from constants import (
    STATUS_CASE_CREATED,
    STATUS_UNREDACTED_UPLOADED,
    STATUS_REVIEWING
)

logger = logging.getLogger(__name__)


def create_case(officer_id: str, officer_name: str) -> Dict[str, Any]:
    """
    Create a new redaction case
    
    Args:
        officer_id: Cognito user ID of the officer
        officer_name: Display name of the officer
        
    Returns:
        Dictionary containing the created case object
        
    Raises:
        Exception: If DynamoDB operation fails
    """
    logger.info(f"Creating new case for officer: {officer_id}")
    
    try:
        # Generate unique case ID
        case_id = generate_case_id()
        timestamp = get_current_timestamp()
        
        # Build case item
        case_item = {
            'case_id': case_id,
            'officer_id': officer_id,
            'officer_name': officer_name,
            'status': STATUS_CASE_CREATED,
            'created_at': timestamp,
            'updated_at': timestamp,
            's3_paths': {
                'intake_form': None,
                'unredacted_doc': None,
                'redaction_proposals': None,
                'edited_redactions': None,
                'redacted_doc': None
            },
            'metadata': {
                'total_pages': None,
                'total_redactions_proposed': None,
                'total_redactions_applied': None
            },
            'error_info': {
                'last_error': None,
                'error_count': 0,
                'last_error_timestamp': None
            }
        }
        
        # Save to DynamoDB
        put_dynamodb_item(case_item)
        
        logger.info(f"Successfully created case: {case_id}")
        return case_item
        
    except Exception as e:
        logger.error(f"Failed to create case: {str(e)}", exc_info=True)
        raise


def get_case(case_id: str) -> Dict[str, Any]:
    """
    Retrieve a case by ID
    
    Args:
        case_id: Unique case identifier
        
    Returns:
        Dictionary containing the case object
        
    Raises:
        ValueError: If case not found
        Exception: If DynamoDB operation fails
    """
    logger.info(f"Retrieving case: {case_id}")
    
    try:
        case = get_dynamodb_item(case_id)
        
        if not case:
            raise ValueError(f"Case not found: {case_id}")
        
        logger.info(f"Successfully retrieved case: {case_id}")
        return case
        
    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Failed to retrieve case {case_id}: {str(e)}", exc_info=True)
        raise


def list_cases(
    officer_id: str,
    status: Optional[str] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """
    List cases for an officer, optionally filtered by status
    
    Args:
        officer_id: Cognito user ID to filter by (as string)
        status: Optional status filter
        limit: Maximum number of cases to return
        
    Returns:
        List of case dictionaries
        
    Raises:
        Exception: If DynamoDB query fails
    """
    logger.info(f"Listing cases for officer: {officer_id}, status: {status}, limit: {limit}")
    
    # Ensure officer_id is a string
    officer_id = str(officer_id)
    
    try:
        if status:
            # Query by status first, then filter by officer
            # This is less efficient but handles the query pattern
            cases = query_dynamodb_by_index('status-index', 'status', status, limit=limit)
            # Filter to only cases owned by this officer
            cases = [case for case in cases if case.get('officer_id') == officer_id]
        else:
            # Query by officer_id using officer-index
            cases = query_dynamodb_by_index('officer-index', 'officer_id', officer_id, limit=limit)
        
        logger.info(f"Found {len(cases)} cases")
        return cases
        
    except Exception as e:
        logger.error(f"Failed to list cases: {str(e)}", exc_info=True)
        raise


def update_case_status(
    case_id: str,
    new_status: str,
    metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Update case status and optionally trigger Bedrock Lambda
    
    Args:
        case_id: Unique case identifier
        new_status: New status value
        metadata: Optional metadata to merge into case
        
    Returns:
        Updated case object
        
    Raises:
        ValueError: If case not found or invalid status
        Exception: If update fails
    """
    logger.info(f"Updating case {case_id} status to: {new_status}")
    
    try:
        # Get current case
        case = get_case(case_id)
        current_status = case['status']
        
        # Build update expression
        timestamp = get_current_timestamp()
        update_values = {
            'status': new_status,
            'updated_at': timestamp
        }
        
        # Merge metadata if provided
        if metadata:
            for key, value in metadata.items():
                update_values[f'metadata.{key}'] = value
        
        # Update DynamoDB
        update_dynamodb_item(case_id, update_values)
        
        # Get updated case for return and for triggering
        updated_case = get_case(case_id)
        
        # Determine if we should trigger Bedrock Lambda
        should_trigger, action = should_trigger_bedrock_lambda(current_status, new_status)
        
        if should_trigger:
            logger.info(f"Triggering Bedrock Lambda with action: {action}")
            
            # Build S3 paths for Bedrock Lambda
            s3_paths = build_s3_paths_for_bedrock(case_id, updated_case)
            
            # Invoke Bedrock Lambda asynchronously
            invoke_bedrock_lambda(
                action=action,
                case_id=case_id,
                s3_paths=s3_paths
            )
            
            logger.info(f"Successfully triggered Bedrock Lambda for case: {case_id}")
        
        logger.info(f"Successfully updated case {case_id} to status: {new_status}")
        return updated_case
        
    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Failed to update case status: {str(e)}", exc_info=True)
        raise


def update_case_s3_path(
    case_id: str,
    path_type: str,
    s3_path: str
) -> Dict[str, Any]:
    """
    Update a specific S3 path in the case record
    
    Args:
        case_id: Unique case identifier
        path_type: Type of path (intake_form, unredacted_doc, etc.)
        s3_path: Full S3 path
        
    Returns:
        Updated case object
        
    Raises:
        ValueError: If case not found or invalid path_type
        Exception: If update fails
    """
    logger.info(f"Updating S3 path for case {case_id}: {path_type} = {s3_path}")
    
    # Validate path_type
    valid_path_types = ['intake_form', 'unredacted_doc', 'redaction_proposals', 
                       'edited_redactions', 'redacted_doc']
    if path_type not in valid_path_types:
        raise ValueError(f"Invalid path_type: {path_type}. Must be one of {valid_path_types}")
    
    try:
        # Verify case exists
        case = get_case(case_id)
        
        # Update S3 path
        timestamp = get_current_timestamp()
        update_values = {
            f's3_paths.{path_type}': s3_path,
            'updated_at': timestamp
        }
        
        update_dynamodb_item(case_id, update_values)
        
        # Get and return updated case
        updated_case = get_case(case_id)
        
        logger.info(f"Successfully updated S3 path for case: {case_id}")
        return updated_case
        
    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Failed to update S3 path: {str(e)}", exc_info=True)
        raise


def delete_case(case_id: str) -> None:
    """
    Delete a case and its associated S3 files
    
    Args:
        case_id: Unique case identifier
        
    Raises:
        ValueError: If case not found
        Exception: If deletion fails
    """
    logger.info(f"Deleting case: {case_id}")
    
    try:
        # Verify case exists before deleting
        case = get_case(case_id)
        
        # Delete S3 files associated with the case
        s3_paths = case.get('s3_paths', {})
        deleted_files = []
        
        for path_type, s3_path in s3_paths.items():
            if s3_path:
                try:
                    from utils import delete_s3_object
                    delete_s3_object(s3_path)
                    deleted_files.append(path_type)
                    logger.info(f"Deleted S3 file: {path_type} ({s3_path})")
                except Exception as e:
                    logger.warning(f"Failed to delete S3 file {path_type}: {str(e)}")
                    # Continue deleting other files even if one fails
        
        # Delete the case from DynamoDB
        from utils import delete_dynamodb_item
        delete_dynamodb_item(case_id)
        
        logger.info(f"Successfully deleted case: {case_id} (deleted {len(deleted_files)} S3 files)")
        
    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Failed to delete case {case_id}: {str(e)}", exc_info=True)
        raise


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def should_trigger_bedrock_lambda(
    current_status: str,
    new_status: str
) -> tuple[bool, Optional[str]]:
    """
    Determine if Bedrock Lambda should be triggered based on status transition
    
    Args:
        current_status: Current case status
        new_status: New case status
        
    Returns:
        Tuple of (should_trigger: bool, action: str or None)
    """
    # Trigger with action="process" when unredacted doc is uploaded
    if new_status == STATUS_UNREDACTED_UPLOADED:
        return (True, "process")
    
    # Trigger with action="apply" when officer finishes reviewing/editing redactions
    if new_status == STATUS_REVIEWING and current_status != STATUS_REVIEWING:
        # This means officer just moved to reviewing state
        # We'll trigger when they mark it complete (separate status update)
        return (False, None)
    
    # Custom status for "ready to apply redactions" could be added
    # For now, assume REVIEWING means they've finished editing
    # In practice, you might want a STATUS_READY_TO_APPLY
    
    return (False, None)


def build_s3_paths_for_bedrock(
    case_id: str,
    case: Dict[str, Any]
) -> Dict[str, str]:
    """
    Build S3 paths dictionary for Bedrock Lambda invocation
    
    Args:
        case_id: Unique case identifier
        case: Case object from DynamoDB
        
    Returns:
        Dictionary of S3 paths
    """
    s3_paths_from_case = case.get('s3_paths', {})
    
    # Build complete S3 paths (construct if not in DB yet)
    return {
        'unredacted_doc': s3_paths_from_case.get('unredacted_doc') or build_s3_path(case_id, 'unredacted'),
        'redaction_proposals': s3_paths_from_case.get('redaction_proposals') or build_s3_path(case_id, 'redaction_proposals'),
        'edited_redactions': s3_paths_from_case.get('edited_redactions') or build_s3_path(case_id, 'edited_redactions'),
        'redacted_doc': s3_paths_from_case.get('redacted_doc') or build_s3_path(case_id, 'redacted_doc')
    }