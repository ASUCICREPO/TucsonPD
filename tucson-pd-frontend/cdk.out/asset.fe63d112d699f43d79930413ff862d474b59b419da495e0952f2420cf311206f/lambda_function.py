import json
import logging
import traceback
from utilities import (
    handle_create_request, handle_update_request, handle_delete_request,
    send_cfn_response
)
from constants import CFN_SUCCESS, RESPONSE_MESSAGES

import constants  # This configures logging

logger = logging.getLogger(__name__)


def lambda_handler(event, context):
    """
    Main entry point for CloudFormation custom resource Lambda function.
    
    Handles CloudFormation lifecycle events (Create, Update, Delete) for
    Amplify app deployment. Routes requests to appropriate handlers and
    ensures CloudFormation always receives a response.
    
    Args:
        event: CloudFormation event data containing request type and parameters
        context: Lambda context object with runtime information
        
    Returns:
        None: All responses sent directly to CloudFormation via utilities
    """
    logger.info("Starting CloudFormation custom resource handler")
    
    # Log the incoming event for debugging
    try:
        logger.debug("CloudFormation Event:")
        logger.debug(json.dumps(event, indent=2))
    except Exception as e:
        logger.warning(f"Failed to log event data: {str(e)}")
    
    try:
        # Extract and validate request type
        request_type = event.get('RequestType')
        if not request_type:
            logger.error("Missing RequestType in CloudFormation event")
            send_cfn_response(event, context, CFN_SUCCESS, 
                            {"Error": "Missing RequestType in event"})
            return
        
        logger.info(f"Processing CloudFormation request type: {request_type}")
        
        # Route to appropriate handler based on request type
        if request_type == "Create":
            logger.info("Routing to Create request handler")
            handle_create_request(event, context)
            
        elif request_type == "Update":
            logger.info("Routing to Update request handler")
            handle_update_request(event, context)
            
        elif request_type == "Delete":
            logger.info("Routing to Delete request handler")
            handle_delete_request(event, context)
            
        else:
            # Handle any unexpected request types gracefully
            logger.warning(f"Received unknown request type: {request_type}")
            success_message = f"{request_type} {RESPONSE_MESSAGES['GENERIC_SUCCESS']}"
            send_cfn_response(event, context, CFN_SUCCESS, {"Message": success_message})

    
    
    except KeyError as e:
        # Handle missing required fields in event
        error_msg = f"Missing required field in CloudFormation event: {str(e)}"
        logger.error(error_msg)
        logger.debug(f"Event structure: {json.dumps(event, default=str)}")
        
        try:
            send_cfn_response(event, context, CFN_SUCCESS, {"Error": error_msg})
        except Exception as response_error:
            logger.error(f"Failed to send error response to CloudFormation: {str(response_error)}")
    
    except Exception as e:
        # Catch-all error handler to ensure CloudFormation always gets a response
        error_msg = f"Unexpected error in CloudFormation handler: {str(e)}"
        logger.error(error_msg)
        logger.debug(f"Full traceback: {traceback.format_exc()}")
        
        # Always attempt to notify CloudFormation, even on unexpected failures
        try:
            send_cfn_response(event, context, CFN_SUCCESS, {"Error": error_msg})
        except Exception as response_error:
            # Last resort logging - function should not completely fail
            logger.critical(f"Critical failure - cannot respond to CloudFormation: {str(response_error)}")
            logger.critical("CloudFormation stack may be stuck - manual intervention required")
    
    finally:
        logger.info("CloudFormation custom resource handler completed")