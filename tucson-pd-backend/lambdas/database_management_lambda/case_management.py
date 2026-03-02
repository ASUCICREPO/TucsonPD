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
    delete_dynamodb_item,
    delete_s3_object,
    query_dynamodb_by_index,
    scan_all_cases,
    invoke_bedrock_lambda,
    build_s3_path
)
from constants import (
    STATUS_CASE_CREATED,
    STATUS_UNREDACTED_UPLOADED,
    STATUS_APPLYING_REDACTIONS,
)

logger = logging.getLogger(__name__)


def create_case(officer_id: str, officer_name: str) -> Dict[str, Any]:
    """
    Create a new redaction case.

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
        case_id = generate_case_id()
        timestamp = get_current_timestamp()

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

        put_dynamodb_item(case_item)

        logger.info(f"Successfully created case: {case_id}")
        return case_item

    except Exception as e:
        logger.error(f"Failed to create case: {str(e)}", exc_info=True)
        raise


def get_case(case_id: str) -> Dict[str, Any]:
    """
    Retrieve a case by ID.

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
    limit: int = 50,
    exclude_officer_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    List cases for an officer, or all cases excluding a specific officer.

    When exclude_officer_id is provided, returns all cases NOT belonging to
    that officer — used to populate the "Other Redactions" tab on the dashboard.
    When called normally (no exclusion), returns only the calling officer's cases
    via the officer-index GSI.

    Args:
        officer_id: Cognito user ID of the requesting officer
        status: Optional status filter (raw backend constant e.g. 'REVIEW_READY')
        limit: Maximum number of cases to return
        exclude_officer_id: If provided, return all cases except this officer's

    Returns:
        List of case dictionaries

    Raises:
        Exception: If DynamoDB query fails
    """
    logger.info(
        f"Listing cases — officer: {officer_id}, status: {status}, "
        f"limit: {limit}, exclude: {exclude_officer_id}"
    )

    try:
        if exclude_officer_id:
            # "Other Redactions" tab — scan all cases and exclude the requesting officer
            logger.info(f"Fetching all cases excluding officer: {exclude_officer_id}")
            cases = scan_all_cases(limit=limit)
            cases = [c for c in cases if c.get('officer_id') != exclude_officer_id]

            if status:
                cases = [c for c in cases if c.get('status') == status]

        elif status:
            # Query by status GSI, then filter to this officer
            cases = query_dynamodb_by_index(
                'status-index', 'status', status, limit=limit
            )
            cases = [c for c in cases if c.get('officer_id') == str(officer_id)]

        else:
            # Default: query officer's own cases via officer-index GSI
            cases = query_dynamodb_by_index(
                'officer-index', 'officer_id', str(officer_id), limit=limit
            )

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
    Update case status, optionally update metadata counters, and trigger
    the Bedrock Lambda when the transition requires it.

    Trigger rules:
      UNREDACTED_UPLOADED  → Bedrock action="process"  (generate redaction proposals)
      APPLYING_REDACTIONS  → Bedrock action="apply"    (apply approved redactions)

    Args:
        case_id: Unique case identifier
        new_status: New status value (raw backend constant)
        metadata: Optional metadata fields to merge (e.g. total_pages)

    Returns:
        Updated case object

    Raises:
        ValueError: If case not found
        Exception: If update or Lambda invocation fails
    """
    logger.info(f"Updating case {case_id} status to: {new_status}")

    try:
        case = get_case(case_id)
        current_status = case['status']

        timestamp = get_current_timestamp()
        update_values: Dict[str, Any] = {
            'status': new_status,
            'updated_at': timestamp
        }

        if metadata:
            for key, value in metadata.items():
                update_values[f'metadata.{key}'] = value

        update_dynamodb_item(case_id, update_values)

        # Re-fetch so we have the full updated record before deciding to trigger
        updated_case = get_case(case_id)

        should_trigger, action = should_trigger_bedrock_lambda(current_status, new_status)

        if should_trigger:
            logger.info(f"Triggering Bedrock Lambda with action: {action}")
            s3_paths = build_s3_paths_for_bedrock(case_id, updated_case)
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
    Update a specific S3 path in the case record.

    Args:
        case_id: Unique case identifier
        path_type: Key within s3_paths (intake_form | unredacted_doc |
                   redaction_proposals | edited_redactions | redacted_doc)
        s3_path: Full S3 path (s3://bucket/key)

    Returns:
        Updated case object

    Raises:
        ValueError: If case not found or path_type is invalid
        Exception: If update fails
    """
    logger.info(f"Updating S3 path for case {case_id}: {path_type} = {s3_path}")

    valid_path_types = [
        'intake_form',
        'unredacted_doc',
        'redaction_proposals',
        'edited_redactions',
        'redacted_doc',
    ]
    if path_type not in valid_path_types:
        raise ValueError(
            f"Invalid path_type: {path_type}. Must be one of {valid_path_types}"
        )

    try:
        # Verify case exists before updating
        get_case(case_id)

        timestamp = get_current_timestamp()
        update_values = {
            f's3_paths.{path_type}': s3_path,
            'updated_at': timestamp
        }

        update_dynamodb_item(case_id, update_values)

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
    Delete a case record and all its associated S3 files.

    S3 deletion failures are logged as warnings but do not abort the operation —
    the DynamoDB record is always removed if it exists.

    Args:
        case_id: Unique case identifier

    Raises:
        ValueError: If case not found
        Exception: If DynamoDB deletion fails
    """
    logger.info(f"Deleting case: {case_id}")

    try:
        case = get_case(case_id)

        s3_paths = case.get('s3_paths', {})
        deleted_files = []

        for path_type, s3_path in s3_paths.items():
            path_to_delete = s3_path or build_s3_path(case_id, path_type)
            try:
                delete_s3_object(path_to_delete)
                deleted_files.append(path_type)
                logger.info(f"Deleted S3 file: {path_type} ({path_to_delete})")
            except Exception as e:
                logger.warning(f"Failed to delete S3 file {path_type}: {str(e)}")

        delete_dynamodb_item(case_id)

        logger.info(
            f"Successfully deleted case: {case_id} "
            f"(deleted {len(deleted_files)} S3 files)"
        )

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
    Determine whether the Bedrock Lambda should be invoked based on the
    status transition, and which action to pass if so.

    Trigger rules:
      → UNREDACTED_UPLOADED : action="process"
          The unredacted document has just landed in S3.
          Bedrock will extract text, run it against the active guideline,
          and write a redaction-proposals JSON back to S3.

      → APPLYING_REDACTIONS : action="apply"
          The officer has finished reviewing proposals and submitted their
          edited redactions JSON. Bedrock will apply the approved redactions
          to the original PDF and write the redacted document to S3.

    Args:
        current_status: The case's status before this update
        new_status: The status being set now

    Returns:
        (should_trigger, action) — action is None when should_trigger is False
    """
    if new_status == STATUS_UNREDACTED_UPLOADED:
        return (True, "process")

    if new_status == STATUS_APPLYING_REDACTIONS:
        return (True, "apply")

    return (False, None)


def build_s3_paths_for_bedrock(
    case_id: str,
    case: Dict[str, Any]
) -> Dict[str, str]:
    """
    Build the S3 paths dictionary passed to the Bedrock Lambda.

    Prefers paths already recorded on the case record; falls back to the
    canonical constructed path if a field is not yet populated.

    Args:
        case_id: Unique case identifier
        case: Full case object from DynamoDB

    Returns:
        Dictionary of S3 paths keyed by file type
    """
    s3_paths_from_case = case.get('s3_paths', {})

    return {
        'unredacted_doc': (
            s3_paths_from_case.get('unredacted_doc')
            or build_s3_path(case_id, 'unredacted_doc')
        ),
        'redaction_proposals': (
            s3_paths_from_case.get('redaction_proposals')
            or build_s3_path(case_id, 'redaction_proposals')
        ),
        'edited_redactions': (
            s3_paths_from_case.get('edited_redactions')
            or build_s3_path(case_id, 'edited_redactions')
        ),
        'redacted_doc': (
            s3_paths_from_case.get('redacted_doc')
            or build_s3_path(case_id, 'redacted_doc')
        ),
    }