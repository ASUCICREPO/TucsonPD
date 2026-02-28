"""
Utilities Module for Database Lambda

This module contains all helper functions for AWS services (S3, DynamoDB, Lambda)
and common utility operations.
"""

import json
import logging
import uuid
import time
import boto3
from typing import Dict, Any, List, Optional, Tuple
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Key
from decimal import Decimal

from constants import (
    AWS_REGION,
    DYNAMODB_TABLE_NAME,
    DYNAMODB_GUIDELINES_TABLE_NAME,
    S3_BUCKET_NAME,
    BEDROCK_LAMBDA_NAME,
    CORS_HEADERS,
    S3_PATH_INTAKE_FORM,
    S3_PATH_UNREDACTED,
    S3_PATH_REDACTION_PROPOSALS,
    S3_PATH_EDITED_REDACTIONS,
    S3_PATH_REDACTED
)

logger = logging.getLogger(__name__)

# ============================================================================
# BOTO3 CLIENT INITIALIZATION
# ============================================================================

# Initialize AWS clients once at module load
s3_client = boto3.client('s3', region_name=AWS_REGION)
dynamodb_resource = boto3.resource('dynamodb', region_name=AWS_REGION)
lambda_client = boto3.client('lambda', region_name=AWS_REGION)

# Get DynamoDB table references
dynamodb_table = dynamodb_resource.Table(DYNAMODB_TABLE_NAME)
guidelines_table = dynamodb_resource.Table(DYNAMODB_GUIDELINES_TABLE_NAME)

logger.info(f"AWS clients initialized for region: {AWS_REGION}")
logger.info(f"Cases table: {DYNAMODB_TABLE_NAME}")
logger.info(f"Guidelines table: {DYNAMODB_GUIDELINES_TABLE_NAME}")


# ============================================================================
# DYNAMODB FUNCTIONS - CASES
# ============================================================================

def get_dynamodb_item(case_id: str) -> Optional[Dict[str, Any]]:
    """
    Retrieve a case item from DynamoDB
    
    Args:
        case_id: Unique case identifier
        
    Returns:
        Case dictionary or None if not found
        
    Raises:
        ClientError: If DynamoDB operation fails
    """
    logger.info(f"Getting DynamoDB item: {case_id}")
    
    try:
        response = dynamodb_table.get_item(Key={'case_id': case_id})
        item = response.get('Item')
        
        if item:
            # Convert Decimal types to native Python types
            item = json.loads(json.dumps(item, default=decimal_default))
        
        return item
        
    except ClientError as e:
        logger.error(f"Failed to get DynamoDB item: {case_id}")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error getting DynamoDB item: {e}")
        raise


def put_dynamodb_item(item: Dict[str, Any]) -> None:
    """
    Create a new item in DynamoDB
    
    Args:
        item: Complete item dictionary to insert
        
    Raises:
        ClientError: If DynamoDB operation fails
    """
    logger.info(f"Putting DynamoDB item: {item.get('case_id')}")
    
    try:
        dynamodb_table.put_item(Item=item)
        logger.info("Successfully created DynamoDB item")
        
    except ClientError as e:
        logger.error(f"Failed to put DynamoDB item")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error putting DynamoDB item: {e}")
        raise


def update_dynamodb_item(
    case_id: str,
    update_values: Dict[str, Any]
) -> None:
    """
    Update specific fields in a DynamoDB item
    
    Args:
        case_id: Unique case identifier
        update_values: Dictionary of field paths to new values
                      e.g., {'status': 'COMPLETED', 'metadata.total_pages': 5}
        
    Raises:
        ClientError: If DynamoDB operation fails
    """
    logger.info(f"Updating DynamoDB item: {case_id}")
    
    try:
        # Build update expression
        update_expression_parts = []
        expression_attribute_names = {}
        expression_attribute_values = {}
        
        for key, value in update_values.items():
            # Handle nested paths (e.g., 'metadata.total_pages')
            if '.' in key:
                parts = key.split('.')
                # Build attribute name placeholders
                name_placeholders = []
                for i, part in enumerate(parts):
                    placeholder = f"#attr{i}_{part}"
                    expression_attribute_names[placeholder] = part
                    name_placeholders.append(placeholder)
                
                # Build expression
                attr_path = '.'.join(name_placeholders)
                value_placeholder = f":val_{key.replace('.', '_')}"
                expression_attribute_values[value_placeholder] = value
                update_expression_parts.append(f"{attr_path} = {value_placeholder}")
            else:
                # Simple attribute
                name_placeholder = f"#{key}"
                value_placeholder = f":{key}"
                expression_attribute_names[name_placeholder] = key
                expression_attribute_values[value_placeholder] = value
                update_expression_parts.append(f"{name_placeholder} = {value_placeholder}")
        
        update_expression = "SET " + ", ".join(update_expression_parts)
        
        # Update item
        dynamodb_table.update_item(
            Key={'case_id': case_id},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values
        )
        
        logger.info(f"Successfully updated DynamoDB item: {case_id}")
        
    except ClientError as e:
        logger.error(f"Failed to update DynamoDB item: {case_id}")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error updating DynamoDB item: {e}")
        raise


def query_dynamodb_by_index(
    index_name: str,
    key_name: str,
    key_value: Any,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """
    Query DynamoDB using a Global Secondary Index
    
    Args:
        index_name: Name of the GSI to query
        key_name: Partition key name for the index
        key_value: Value to query for
        limit: Maximum number of items to return
        
    Returns:
        List of matching items
        
    Raises:
        ClientError: If DynamoDB query fails
    """
    logger.info(f"Querying DynamoDB index {index_name} for {key_name}={key_value}")
    
    try:
        response = dynamodb_table.query(
            IndexName=index_name,
            KeyConditionExpression=Key(key_name).eq(key_value),
            Limit=limit,
            ScanIndexForward=False  # Most recent first (descending by sort key)
        )
        
        items = response.get('Items', [])
        
        # Convert Decimal types to native Python types
        items = json.loads(json.dumps(items, default=decimal_default))
        
        logger.info(f"Query returned {len(items)} items")
        return items
        
    except ClientError as e:
        logger.error(f"Failed to query DynamoDB index: {index_name}")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error querying DynamoDB: {e}")
        raise


def delete_dynamodb_item(case_id: str) -> None:
    """
    Delete a case item from DynamoDB
    
    Args:
        case_id: Unique case identifier
        
    Raises:
        ClientError: If DynamoDB operation fails
    """
    logger.info(f"Deleting DynamoDB item: {case_id}")
    
    try:
        dynamodb_table.delete_item(Key={'case_id': case_id})
        logger.info(f"Successfully deleted DynamoDB item: {case_id}")
        
    except ClientError as e:
        logger.error(f"Failed to delete DynamoDB item: {case_id}")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error deleting DynamoDB item: {e}")
        raise


def scan_all_cases(limit: int = 100) -> List[Dict[str, Any]]:
    """
    Scan all cases from DynamoDB, used for the "Other Redactions" tab
    where we need every case that doesn't belong to the requesting officer.
    
    Pagination is handled automatically up to the limit.
    
    Args:
        limit: Maximum total number of cases to return
        
    Returns:
        List of all case items up to the limit
        
    Raises:
        ClientError: If DynamoDB scan fails
    """
    logger.info(f"Scanning all cases (limit: {limit})")
    
    try:
        items = []
        scan_kwargs = {}
        
        while True:
            response = dynamodb_table.scan(**scan_kwargs)
            batch = response.get('Items', [])
            items.extend(batch)
            
            # Stop if we've hit the limit or there are no more pages
            if len(items) >= limit or 'LastEvaluatedKey' not in response:
                break
            
            # Set up next page
            scan_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
        
        # Trim to limit and convert Decimal types
        items = items[:limit]
        items = json.loads(json.dumps(items, default=decimal_default))
        
        # Sort most recent first
        items.sort(key=lambda x: x.get('created_at', 0), reverse=True)
        
        logger.info(f"Scan returned {len(items)} cases")
        return items
        
    except ClientError as e:
        logger.error(f"Failed to scan cases table")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error scanning cases: {e}")
        raise


# ============================================================================
# DYNAMODB FUNCTIONS - GUIDELINES
# ============================================================================

def get_guidelines_item(guideline_id: str) -> Optional[Dict[str, Any]]:
    """
    Retrieve a guideline item from DynamoDB
    
    Args:
        guideline_id: Unique guideline identifier
        
    Returns:
        Guideline dictionary or None if not found
        
    Raises:
        ClientError: If DynamoDB operation fails
    """
    logger.info(f"Getting Guidelines item: {guideline_id}")
    
    try:
        response = guidelines_table.get_item(Key={'guideline_id': guideline_id})
        item = response.get('Item')
        
        if item:
            # Convert Decimal types to native Python types
            item = json.loads(json.dumps(item, default=decimal_default))
        
        return item
        
    except ClientError as e:
        logger.error(f"Failed to get Guidelines item: {guideline_id}")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error getting Guidelines item: {e}")
        raise


def put_guidelines_item(item: Dict[str, Any]) -> None:
    """
    Create a new guideline in DynamoDB
    
    Args:
        item: Complete guideline dictionary to insert
        
    Raises:
        ClientError: If DynamoDB operation fails
    """
    logger.info(f"Putting Guidelines item: {item.get('guideline_id')}")
    
    try:
        guidelines_table.put_item(Item=item)
        logger.info("Successfully created Guidelines item")
        
    except ClientError as e:
        logger.error(f"Failed to put Guidelines item")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error putting Guidelines item: {e}")
        raise


def update_guidelines_item(
    guideline_id: str,
    update_values: Dict[str, Any]
) -> None:
    """
    Update specific fields in a guideline item
    
    Args:
        guideline_id: Unique guideline identifier
        update_values: Dictionary of field paths to new values
        
    Raises:
        ClientError: If DynamoDB operation fails
    """
    logger.info(f"Updating Guidelines item: {guideline_id}")
    
    try:
        # Build update expression (same logic as cases)
        update_expression_parts = []
        expression_attribute_names = {}
        expression_attribute_values = {}
        
        for key, value in update_values.items():
            # Handle nested paths
            if '.' in key:
                parts = key.split('.')
                name_placeholders = []
                for i, part in enumerate(parts):
                    placeholder = f"#attr{i}_{part}"
                    expression_attribute_names[placeholder] = part
                    name_placeholders.append(placeholder)
                
                attr_path = '.'.join(name_placeholders)
                value_placeholder = f":val_{key.replace('.', '_')}"
                expression_attribute_values[value_placeholder] = value
                update_expression_parts.append(f"{attr_path} = {value_placeholder}")
            else:
                # Simple attribute
                name_placeholder = f"#{key}"
                value_placeholder = f":{key}"
                expression_attribute_names[name_placeholder] = key
                expression_attribute_values[value_placeholder] = value
                update_expression_parts.append(f"{name_placeholder} = {value_placeholder}")
        
        update_expression = "SET " + ", ".join(update_expression_parts)
        
        # Update item
        guidelines_table.update_item(
            Key={'guideline_id': guideline_id},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values
        )
        
        logger.info(f"Successfully updated Guidelines item: {guideline_id}")
        
    except ClientError as e:
        logger.error(f"Failed to update Guidelines item: {guideline_id}")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error updating Guidelines item: {e}")
        raise


def query_all_guidelines() -> List[Dict[str, Any]]:
    """
    Retrieve all guidelines from DynamoDB
    
    Returns:
        List of all guideline items
        
    Raises:
        ClientError: If DynamoDB scan fails
    """
    logger.info("Querying all guidelines")
    
    try:
        # Use scan to get all items (guidelines table should be small)
        response = guidelines_table.scan()
        items = response.get('Items', [])
        
        # Handle pagination if needed
        while 'LastEvaluatedKey' in response:
            response = guidelines_table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])
            items.extend(response.get('Items', []))
        
        # Convert Decimal types
        items = json.loads(json.dumps(items, default=decimal_default))
        
        # Sort by created_at descending (most recent first)
        items.sort(key=lambda x: x.get('created_at', 0), reverse=True)
        
        logger.info(f"Retrieved {len(items)} guidelines")
        return items
        
    except ClientError as e:
        logger.error(f"Failed to query all guidelines")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error querying guidelines: {e}")
        raise


def get_active_guideline_from_db() -> Optional[Dict[str, Any]]:
    """
    Get the active guideline from DynamoDB
    
    Returns:
        Active guideline item or None if no active guideline
        
    Raises:
        ClientError: If DynamoDB scan fails
    """
    logger.info("Getting active guideline from DB")
    
    try:
        # Scan for active guideline
        response = guidelines_table.scan(
            FilterExpression='#status = :active',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={':active': 'active'}
        )
        
        items = response.get('Items', [])
        
        if not items:
            return None
        
        if len(items) > 1:
            logger.warning(f"Multiple active guidelines found: {len(items)}. Using first one.")
        
        # Convert Decimal types
        item = json.loads(json.dumps(items[0], default=decimal_default))
        
        logger.info(f"Found active guideline: {item['guideline_id']}")
        return item
        
    except ClientError as e:
        logger.error(f"Failed to get active guideline")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error getting active guideline: {e}")
        raise


def delete_guidelines_item(guideline_id: str) -> None:
    """
    Delete a guideline from DynamoDB
    
    Args:
        guideline_id: Unique guideline identifier
        
    Raises:
        ClientError: If DynamoDB operation fails
    """
    logger.info(f"Deleting Guidelines item: {guideline_id}")
    
    try:
        guidelines_table.delete_item(Key={'guideline_id': guideline_id})
        logger.info(f"Successfully deleted Guidelines item: {guideline_id}")
        
    except ClientError as e:
        logger.error(f"Failed to delete Guidelines item: {guideline_id}")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error deleting Guidelines item: {e}")
        raise


# ============================================================================
# S3 FUNCTIONS
# ============================================================================

def generate_presigned_post(
    bucket: str,
    key: str,
    expires_in: int = 300,
    content_type: str = 'application/octet-stream'
) -> Dict[str, Any]:
    """
    Generate a pre-signed POST URL for uploading to S3
    
    Args:
        bucket: S3 bucket name
        key: S3 object key
        expires_in: URL expiration in seconds
        content_type: MIME type of the file
        
    Returns:
        Dictionary with 'url' and 'fields' for POST request
        
    Raises:
        ClientError: If S3 operation fails
    """
    logger.info(f"Generating pre-signed POST for s3://{bucket}/{key}")
    
    try:
        response = s3_client.generate_presigned_post(
            Bucket=bucket,
            Key=key,
            Fields={'Content-Type': content_type},
            Conditions=[
                {'Content-Type': content_type},
                ['content-length-range', 1, 52428800]  # 1 byte to 50 MB
            ],
            ExpiresIn=expires_in
        )
        
        logger.info("Successfully generated pre-signed POST URL")
        return response
        
    except ClientError as e:
        logger.error(f"Failed to generate pre-signed POST")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error generating pre-signed POST: {e}")
        raise


def generate_presigned_url(
    bucket: str,
    key: str,
    expires_in: int = 300,
    method: str = 'GET'
) -> str:
    """
    Generate a pre-signed URL for S3 operations
    
    Args:
        bucket: S3 bucket name
        key: S3 object key
        expires_in: URL expiration in seconds
        method: HTTP method (GET, PUT, etc.)
        
    Returns:
        Pre-signed URL as string
        
    Raises:
        ClientError: If S3 operation fails
    """
    logger.info(f"Generating pre-signed {method} URL for s3://{bucket}/{key}")
    
    try:
        # Map method to boto3 client method name
        client_method_map = {
            'GET': 'get_object',
            'PUT': 'put_object'
        }
        
        client_method = client_method_map.get(method, 'get_object')
        
        url = s3_client.generate_presigned_url(
            ClientMethod=client_method,
            Params={'Bucket': bucket, 'Key': key},
            ExpiresIn=expires_in
        )
        
        logger.info("Successfully generated pre-signed URL")
        return url
        
    except ClientError as e:
        logger.error(f"Failed to generate pre-signed URL")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error generating pre-signed URL: {e}")
        raise


def upload_to_s3(
    bucket: str,
    key: str,
    data: bytes,
    content_type: str = 'application/octet-stream'
) -> None:
    """
    Upload data directly to S3
    
    Args:
        bucket: S3 bucket name
        key: S3 object key
        data: Data to upload (bytes)
        content_type: MIME type
        
    Raises:
        ClientError: If S3 upload fails
    """
    logger.info(f"Uploading to s3://{bucket}/{key}")
    
    try:
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType=content_type
        )
        
        logger.info(f"Successfully uploaded {len(data)} bytes")
        
    except ClientError as e:
        logger.error(f"Failed to upload to S3")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error uploading to S3: {e}")
        raise


def download_from_s3(bucket: str, key: str) -> bytes:
    """
    Download data from S3
    
    Args:
        bucket: S3 bucket name
        key: S3 object key
        
    Returns:
        File contents as bytes
        
    Raises:
        ClientError: If S3 download fails
    """
    logger.info(f"Downloading from s3://{bucket}/{key}")
    
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        data = response['Body'].read()
        
        logger.info(f"Successfully downloaded {len(data)} bytes")
        return data
        
    except ClientError as e:
        logger.error(f"Failed to download from S3")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error downloading from S3: {e}")
        raise


def delete_s3_object(s3_path: str) -> None:
    """
    Delete an object from S3
    
    Args:
        s3_path: Full S3 path (e.g., 's3://bucket/key' or just 'key')
        
    Raises:
        ClientError: If S3 deletion fails
        ValueError: If s3_path is invalid
    """
    logger.info(f"Deleting S3 object: {s3_path}")
    
    try:
        # Parse S3 path
        if s3_path.startswith('s3://'):
            # Extract bucket and key from s3://bucket/key format
            path_parts = s3_path.replace('s3://', '').split('/', 1)
            if len(path_parts) != 2:
                raise ValueError(f"Invalid S3 path format: {s3_path}")
            bucket, key = path_parts
        else:
            # Assume it's just a key and use the default bucket
            bucket = S3_BUCKET_NAME
            key = s3_path
        
        # Delete the object
        s3_client.delete_object(Bucket=bucket, Key=key)
        
        logger.info(f"Successfully deleted s3://{bucket}/{key}")
        
    except ClientError as e:
        logger.error(f"Failed to delete S3 object: {s3_path}")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error deleting S3 object: {e}")
        raise


def get_s3_key_for_file_type(case_id: str, file_type: str) -> str:
    """
    Get S3 key for a specific file type
    
    Args:
        case_id: Unique case identifier
        file_type: Type of file
        
    Returns:
        S3 key (path within bucket)
        
    Raises:
        ValueError: If file_type is unknown
    """
    file_type_map = {
        'intake_form': S3_PATH_INTAKE_FORM,
        'unredacted_doc': S3_PATH_UNREDACTED,
        'redaction_proposals': S3_PATH_REDACTION_PROPOSALS,
        'edited_redactions': S3_PATH_EDITED_REDACTIONS,
        'redacted_doc': S3_PATH_REDACTED
    }
    
    template = file_type_map.get(file_type)
    if not template:
        raise ValueError(f"Unknown file_type: {file_type}")
    
    return template.format(case_id=case_id)


def build_s3_path(case_id: str, file_type: str) -> str:
    """
    Build full S3 path (s3://bucket/key) for a file type
    
    Args:
        case_id: Unique case identifier
        file_type: Type of file
        
    Returns:
        Full S3 path as string
    """
    key = get_s3_key_for_file_type(case_id, file_type)
    return f"s3://{S3_BUCKET_NAME}/{key}"


def build_s3_path_for_guideline(guideline_id: str, file_type: str) -> str:
    """
    Build full S3 path for guideline files
    
    Args:
        guideline_id: Unique guideline identifier
        file_type: Type of file ('pdf' or 'json')
        
    Returns:
        Full S3 path as string
        
    Raises:
        ValueError: If file_type is invalid
    """
    if file_type == 'pdf':
        key = f"guidelines/documents/{guideline_id}.pdf"
    elif file_type == 'json':
        key = f"guidelines/processed/{guideline_id}.json"
    else:
        raise ValueError(f"Invalid file_type for guideline: {file_type}. Must be 'pdf' or 'json'")
    
    return f"s3://{S3_BUCKET_NAME}/{key}"


# ============================================================================
# LAMBDA INVOCATION
# ============================================================================

def invoke_bedrock_lambda(
    action: str,
    case_id: str,
    s3_paths: Dict[str, str]
) -> None:
    """
    Invoke the Bedrock Processing Lambda asynchronously
    
    Args:
        action: Action to perform ("process", "apply", or "convert_guidelines")
        case_id: Unique case identifier (or guideline_id for convert_guidelines)
        s3_paths: Dictionary of S3 paths for the case/guideline
        
    Raises:
        ClientError: If Lambda invocation fails
    """
    logger.info(f"Invoking Bedrock Lambda for case {case_id} with action: {action}")
    
    try:
        payload = {
            'action': action,
            'case_id': case_id,
            's3_paths': s3_paths
        }
        
        # Async invocation (don't wait for response)
        lambda_client.invoke(
            FunctionName=BEDROCK_LAMBDA_NAME,
            InvocationType='Event',  # Asynchronous
            Payload=json.dumps(payload)
        )
        
        logger.info(f"Successfully invoked Bedrock Lambda")
        
    except ClientError as e:
        logger.error(f"Failed to invoke Bedrock Lambda")
        logger.error(f"Error: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error invoking Lambda: {e}")
        raise


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def generate_case_id() -> str:
    """
    Generate a unique case ID
    
    Returns:
        UUID string
    """
    return str(uuid.uuid4())


def get_current_timestamp() -> int:
    """
    Get current Unix timestamp
    
    Returns:
        Current time as Unix timestamp (integer)
    """
    return int(time.time())


def parse_request_body(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Parse JSON body from API Gateway event
    
    Args:
        event: API Gateway event object
        
    Returns:
        Parsed body as dictionary
        
    Raises:
        ValueError: If body is missing or invalid JSON
    """
    body = event.get('body')
    
    if not body:
        raise ValueError("Missing request body")
    
    try:
        # Body might already be a dict (from testing) or a string (from API Gateway)
        if isinstance(body, str):
            return json.loads(body)
        return body
        
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in request body: {e}")
        raise ValueError("Invalid JSON in request body")


def build_api_response(
    status_code: int,
    body: Dict[str, Any],
    error: bool = False
) -> Dict[str, Any]:
    """
    Build a properly formatted API Gateway response
    
    Args:
        status_code: HTTP status code
        body: Response body dictionary
        error: Whether this is an error response
        
    Returns:
        API Gateway response object
    """
    return {
        'statusCode': status_code,
        'headers': CORS_HEADERS,
        'body': json.dumps(body)
    }


def decimal_default(obj):
    """
    JSON serializer for Decimal types from DynamoDB
    
    Args:
        obj: Object to serialize
        
    Returns:
        Serialized value
    """
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


logger.info("Utils module loaded successfully")