"""
Utilities Module

This module contains all helper functions for interacting with AWS services
(S3, DynamoDB, Bedrock) and common utility operations.
"""

import json
import logging
import time
import boto3
from typing import Dict, Any, Tuple, List, Optional
from botocore.exceptions import ClientError

from constants import (
    AWS_REGION,
    DYNAMODB_TABLE_NAME,
    DYNAMODB_GUIDELINES_TABLE_NAME
)

logger = logging.getLogger(__name__)

# ============================================================================
# BOTO3 CLIENT INITIALIZATION
# ============================================================================

# Initialize AWS clients once at module load
s3_client = boto3.client('s3', region_name=AWS_REGION)
dynamodb_client = boto3.resource('dynamodb', region_name=AWS_REGION)
bedrock_client = boto3.client('bedrock-runtime', region_name=AWS_REGION)

# Get DynamoDB table references
dynamodb_table = dynamodb_client.Table(DYNAMODB_TABLE_NAME)
guidelines_table = dynamodb_client.Table(DYNAMODB_GUIDELINES_TABLE_NAME)

logger.info(f"AWS clients initialized for region: {AWS_REGION}")
logger.info(f"Cases table: {DYNAMODB_TABLE_NAME}")
logger.info(f"Guidelines table: {DYNAMODB_GUIDELINES_TABLE_NAME}")


# ============================================================================
# S3 FUNCTIONS
# ============================================================================

def download_from_s3(s3_path: str) -> bytes:
    """
    Download a file from S3
    
    Args:
        s3_path: Full S3 path (e.g., "s3://bucket/key/path")
        
    Returns:
        File contents as bytes
        
    Raises:
        ValueError: If S3 path is invalid
        ClientError: If S3 download fails
    """
    logger.info(f"Downloading from S3: {s3_path}")
    
    try:
        bucket, key = parse_s3_path(s3_path)
        
        response = s3_client.get_object(Bucket=bucket, Key=key)
        data = response['Body'].read()
        
        logger.info(f"Successfully downloaded {len(data)} bytes from S3")
        return data
        
    except ClientError as e:
        logger.error(f"Failed to download from S3: {s3_path}")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error downloading from S3: {e}")
        raise


def upload_to_s3(s3_path: str, data: bytes) -> None:
    """
    Upload data to S3
    
    Args:
        s3_path: Full S3 path (e.g., "s3://bucket/key/path")
        data: Data to upload (bytes or string)
        
    Raises:
        ValueError: If S3 path is invalid
        ClientError: If S3 upload fails
    """
    logger.info(f"Uploading to S3: {s3_path}")
    
    try:
        bucket, key = parse_s3_path(s3_path)
        
        # Convert string to bytes if needed
        if isinstance(data, str):
            data = data.encode('utf-8')
        
        # Determine content type based on file extension
        content_type = 'application/octet-stream'
        if key.endswith('.pdf'):
            content_type = 'application/pdf'
        elif key.endswith('.json'):
            content_type = 'application/json'
        
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType=content_type
        )
        
        logger.info(f"Successfully uploaded {len(data)} bytes to S3")
        
    except ClientError as e:
        logger.error(f"Failed to upload to S3: {s3_path}")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error uploading to S3: {e}")
        raise


def parse_s3_path(s3_path: str) -> Tuple[str, str]:
    """
    Parse S3 path into bucket and key components
    
    Args:
        s3_path: Full S3 path (e.g., "s3://bucket/key/path")
        
    Returns:
        Tuple of (bucket_name, key_path)
        
    Raises:
        ValueError: If path format is invalid
    """
    if not s3_path.startswith('s3://'):
        raise ValueError(f"Invalid S3 path format: {s3_path}. Must start with 's3://'")
    
    # Remove s3:// prefix
    path = s3_path[5:]
    
    # Split into bucket and key
    parts = path.split('/', 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid S3 path format: {s3_path}. Must be 's3://bucket/key'")
    
    bucket = parts[0]
    key = parts[1]
    
    if not bucket or not key:
        raise ValueError(f"Invalid S3 path format: {s3_path}. Bucket and key cannot be empty")
    
    return bucket, key


# ============================================================================
# DYNAMODB FUNCTIONS
# ============================================================================

def update_dynamodb_status(
    case_id: str,
    status: str,
    metadata: Optional[Dict[str, Any]] = None
) -> None:
    """
    Update case status in DynamoDB
    
    Args:
        case_id: Unique case identifier
        status: New status value
        metadata: Optional metadata dictionary to merge into the item
        
    Raises:
        ClientError: If DynamoDB update fails
    """
    logger.info(f"Updating DynamoDB status for case {case_id} to {status}")
    
    try:
        timestamp = get_current_timestamp()
        
        # Build update expression
        update_expression = "SET #status = :status, updated_at = :updated_at"
        expression_attribute_names = {
            "#status": "status"
        }
        expression_attribute_values = {
            ":status": status,
            ":updated_at": timestamp
        }
        
        # Add metadata if provided
        if metadata:
            for key, value in metadata.items():
                # Handle nested metadata paths
                if key == "stage":
                    update_expression += ", metadata.#stage = :stage"
                    expression_attribute_names["#stage"] = "stage"
                    expression_attribute_values[":stage"] = value
                elif key.startswith("s3_paths."):
                    # Handle S3 path updates
                    path_key = key.split(".")[1]
                    update_expression += f", s3_paths.#{path_key} = :{path_key}"
                    expression_attribute_names[f"#{path_key}"] = path_key
                    expression_attribute_values[f":{path_key}"] = value
                else:
                    # General metadata
                    safe_key = key.replace(".", "_")
                    update_expression += f", metadata.#{safe_key} = :{safe_key}"
                    expression_attribute_names[f"#{safe_key}"] = key
                    expression_attribute_values[f":{safe_key}"] = value
        
        # Update item
        dynamodb_table.update_item(
            Key={'case_id': case_id},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values
        )
        
        logger.info(f"Successfully updated DynamoDB for case {case_id}")
        
    except ClientError as e:
        logger.error(f"Failed to update DynamoDB for case {case_id}")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error updating DynamoDB: {e}")
        raise


def update_dynamodb_error(
    case_id: str,
    error_message: str,
    previous_status: str
) -> None:
    """
    Update DynamoDB with error information and revert status
    
    Args:
        case_id: Unique case identifier
        error_message: Error message to store
        previous_status: Status to revert to
        
    Raises:
        ClientError: If DynamoDB update fails
    """
    logger.info(f"Updating DynamoDB with error for case {case_id}")
    
    try:
        timestamp = get_current_timestamp()
        
        # Update with error info
        dynamodb_table.update_item(
            Key={'case_id': case_id},
            UpdateExpression="""
                SET #status = :previous_status,
                    updated_at = :updated_at,
                    error_info.last_error = :error_message,
                    error_info.error_count = if_not_exists(error_info.error_count, :zero) + :one,
                    error_info.last_error_timestamp = :updated_at
            """,
            ExpressionAttributeNames={
                "#status": "status"
            },
            ExpressionAttributeValues={
                ":previous_status": previous_status,
                ":updated_at": timestamp,
                ":error_message": error_message,
                ":zero": 0,
                ":one": 1
            }
        )
        
        logger.info(f"Successfully updated error info for case {case_id}")
        
    except ClientError as e:
        logger.error(f"Failed to update error info for case {case_id}")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error updating error info: {e}")
        raise


# ============================================================================
# DYNAMODB FUNCTIONS - GUIDELINES
# ============================================================================

def update_guidelines_status(
    guideline_id: str,
    status: str,
    metadata: Optional[Dict[str, Any]] = None
) -> None:
    """
    Update guideline processing status in DynamoDB
    
    Args:
        guideline_id: Unique guideline identifier
        status: New processing status value
        metadata: Optional metadata dictionary to merge into the item
        
    Raises:
        ClientError: If DynamoDB update fails
    """
    logger.info(f"Updating Guidelines status for {guideline_id} to {status}")
    
    try:
        timestamp = get_current_timestamp()
        
        # Build update expression
        update_expression = "SET processing_status = :status, updated_at = :updated_at"
        expression_attribute_values = {
            ":status": status,
            ":updated_at": timestamp
        }
        
        # Add metadata if provided
        if metadata:
            for key, value in metadata.items():
                safe_key = key.replace(".", "_")
                update_expression += f", {key} = :{safe_key}"
                expression_attribute_values[f":{safe_key}"] = value
        
        # Update item
        guidelines_table.update_item(
            Key={'guideline_id': guideline_id},
            UpdateExpression=update_expression,
            ExpressionAttributeValues=expression_attribute_values
        )
        
        logger.info(f"Successfully updated Guidelines status for {guideline_id}")
        
    except ClientError as e:
        logger.error(f"Failed to update Guidelines status for {guideline_id}")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error updating Guidelines status: {e}")
        raise


def update_guidelines_error(
    guideline_id: str,
    error_message: str
) -> None:
    """
    Update Guidelines table with error information
    
    Args:
        guideline_id: Unique guideline identifier
        error_message: Error message to store
        
    Raises:
        ClientError: If DynamoDB update fails
    """
    logger.info(f"Updating Guidelines with error for {guideline_id}")
    
    try:
        timestamp = get_current_timestamp()
        
        # Update with error info and set status to failed
        guidelines_table.update_item(
            Key={'guideline_id': guideline_id},
            UpdateExpression="""
                SET processing_status = :failed,
                    updated_at = :updated_at,
                    error_info.last_error = :error_message,
                    error_info.error_count = if_not_exists(error_info.error_count, :zero) + :one
            """,
            ExpressionAttributeValues={
                ":failed": "failed",
                ":updated_at": timestamp,
                ":error_message": error_message,
                ":zero": 0,
                ":one": 1
            }
        )
        
        logger.info(f"Successfully updated error info for guideline {guideline_id}")
        
    except ClientError as e:
        logger.error(f"Failed to update Guidelines error info for {guideline_id}")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error updating Guidelines error info: {e}")
        raise


# ============================================================================
# BEDROCK FUNCTIONS
# ============================================================================

def converse_with_bedrock(
    model_id: str,
    messages: List[Dict[str, Any]],
    system_prompts: List[Dict[str, str]],
    inference_config: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Call Bedrock Converse API
    
    Args:
        model_id: Bedrock model identifier
        messages: List of message objects (role + content)
        system_prompts: List of system prompt objects
        inference_config: Configuration dict (temperature, maxTokens, etc.)
        
    Returns:
        Full Bedrock API response
        
    Raises:
        ClientError: If Bedrock API call fails
    """
    logger.info(f"Calling Bedrock model: {model_id}")
    logger.info(f"Inference config: {inference_config}")
    
    try:
        response = bedrock_client.converse(
            modelId=model_id,
            messages=messages,
            system=system_prompts,
            inferenceConfig=inference_config
        )
        
        # Log token usage
        usage = response.get('usage', {})
        logger.info(f"Bedrock response - Input tokens: {usage.get('inputTokens', 0)}, "
                   f"Output tokens: {usage.get('outputTokens', 0)}")
        
        return response
        
    except ClientError as e:
        logger.error(f"Bedrock API call failed")
        logger.error(f"Model ID: {model_id}")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error calling Bedrock: {e}")
        raise


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_current_timestamp() -> int:
    """
    Get current Unix timestamp
    
    Returns:
        Current time as Unix timestamp (integer)
    """
    return int(time.time())


logger.info("Utils module loaded successfully")