"""
Bedrock Processing Lambda - Main Handler

This Lambda is triggered by the Database Management Lambda and routes requests
to process documents (generate redaction proposals), apply redactions, or convert
guideline PDFs to JSON.

Event Structure:
{
    "action": "process" | "apply" | "convert_guidelines",
    "case_id": "uuid",  # or guideline_id for convert_guidelines
    "s3_paths": {
        # For process/apply:
        "unredacted_doc": "s3://bucket/cases/{case_id}/unredacted.pdf",
        "redaction_proposals": "s3://bucket/cases/{case_id}/redaction-proposals.json",
        "edited_redactions": "s3://bucket/cases/{case_id}/edited-redactions.json",
        "redacted_doc": "s3://bucket/cases/{case_id}/redacted.pdf"
        
        # For convert_guidelines:
        "pdf_path": "s3://bucket/guidelines/documents/{guideline_id}.pdf",
        "json_path": "s3://bucket/guidelines/processed/{guideline_id}.json"
    }
}
"""

import json
import logging
from typing import Dict, Any

from process_document import process_document
from apply_redactions import apply_redactions
from convert_guidelines import convert_guidelines
from utils import update_dynamodb_error, update_guidelines_error

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler - routes to appropriate processing function
    
    Args:
        event: Event payload from Database Lambda
        context: Lambda context object
        
    Returns:
        Response dictionary with status and details
    """
    
    logger.info(f"Received event: {json.dumps(event)}")
    
    try:
        # Validate event structure
        if "action" not in event:
            raise ValueError("Missing 'action' field in event")
        
        if "case_id" not in event:
            raise ValueError("Missing 'case_id' field in event")
        
        if "s3_paths" not in event:
            raise ValueError("Missing 's3_paths' field in event")
        
        action = event["action"]
        case_id = event["case_id"]
        s3_paths = event["s3_paths"]
        
        # Route based on action
        if action == "process":
            logger.info(f"Processing document for case: {case_id}")
            result = process_document(case_id, s3_paths)
            
        elif action == "apply":
            logger.info(f"Applying redactions for case: {case_id}")
            result = apply_redactions(case_id, s3_paths)
            
        elif action == "convert_guidelines":
            logger.info(f"Converting guidelines PDF to JSON for guideline: {case_id}")
            # Note: case_id is actually guideline_id for this action
            result = convert_guidelines(case_id, s3_paths)
            
        else:
            raise ValueError(f"Invalid action: {action}. Must be 'process', 'apply', or 'convert_guidelines'")
        
        logger.info(f"Successfully completed action '{action}' for case: {case_id}")
        
        return {
            "statusCode": 200,
            "body": json.dumps({
                "success": True,
                "case_id": case_id,
                "action": action,
                "result": result
            })
        }
        
    except ValueError as e:
        # Validation errors - don't update DynamoDB
        logger.error(f"Validation error: {str(e)}")
        return {
            "statusCode": 400,
            "body": json.dumps({
                "success": False,
                "error": "Validation Error",
                "message": str(e)
            })
        }
        
    except Exception as e:
        # Unexpected errors - log and update DynamoDB if we have case_id
        logger.error(f"Unexpected error: {str(e)}", exc_info=True)
        
        # Try to update DynamoDB with error if we have case_id
        if "case_id" in event and "action" in event:
            try:
                action = event.get("action")
                
                # Use appropriate error handler based on action
                if action == "convert_guidelines":
                    # Update Guidelines table
                    update_guidelines_error(
                        guideline_id=event["case_id"],
                        error_message=str(e)
                    )
                else:
                    # Update Cases table
                    # Determine which status to revert to based on action
                    previous_status = "UNREDACTED_UPLOADED" if action == "process" else "REVIEWING"
                    update_dynamodb_error(
                        case_id=event["case_id"],
                        error_message=str(e),
                        previous_status=previous_status
                    )
            except Exception as db_error:
                logger.error(f"Failed to update DynamoDB with error: {str(db_error)}")
        
        return {
            "statusCode": 500,
            "body": json.dumps({
                "success": False,
                "error": "Internal Server Error",
                "message": str(e)
            })
        }