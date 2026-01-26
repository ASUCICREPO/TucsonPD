"""
Constants and Configuration for Database Management Lambda

This module contains all environment variables, constants, and logging configuration
for the database management and API system.
"""

import os
import logging

# ============================================================================
# LOGGING CONFIGURATION
# ============================================================================

LOG_LEVEL = logging.INFO
LOG_FORMAT = '%(asctime)s - %(levelname)s - %(name)s - %(message)s'

def setup_logging():
    """Configure logging for the entire application"""
    logging.basicConfig(
        level=LOG_LEVEL,
        format=LOG_FORMAT,
        force=True  # Override any existing configuration
    )

# Call setup when constants is imported
setup_logging()


# ============================================================================
# AWS RESOURCE CONFIGURATION
# ============================================================================

# S3 Bucket for case storage
S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME")
if not S3_BUCKET_NAME:
    raise ValueError("S3_BUCKET_NAME environment variable is required")

# DynamoDB table for case metadata
DYNAMODB_TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME")
if not DYNAMODB_TABLE_NAME:
    raise ValueError("DYNAMODB_TABLE_NAME environment variable is required")

# DynamoDB table for guidelines metadata
DYNAMODB_GUIDELINES_TABLE_NAME = os.environ.get("DYNAMODB_GUIDELINES_TABLE_NAME")
if not DYNAMODB_GUIDELINES_TABLE_NAME:
    raise ValueError("DYNAMODB_GUIDELINES_TABLE_NAME environment variable is required")

# Bedrock Processing Lambda name (for invocation)
BEDROCK_LAMBDA_NAME = os.environ.get("BEDROCK_LAMBDA_NAME")
if not BEDROCK_LAMBDA_NAME:
    raise ValueError("BEDROCK_LAMBDA_NAME environment variable is required")

# AWS Region
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")


# ============================================================================
# S3 PATH TEMPLATES
# ============================================================================

# S3 key templates for case files
S3_PATH_INTAKE_FORM = "cases/{case_id}/intake-form.pdf"
S3_PATH_UNREDACTED = "cases/{case_id}/unredacted.pdf"
S3_PATH_REDACTION_PROPOSALS = "cases/{case_id}/redaction-proposals.json"
S3_PATH_EDITED_REDACTIONS = "cases/{case_id}/edited-redactions.json"
S3_PATH_REDACTED = "cases/{case_id}/redacted.pdf"

# S3 path templates for guidelines files
# Note: guideline_id is used instead of case_id for these paths
S3_PATH_GUIDELINE_PDF = "guidelines/documents/{guideline_id}.pdf"
S3_PATH_GUIDELINE_JSON = "guidelines/processed/{guideline_id}.json"


# ============================================================================
# DYNAMODB STATUS CONSTANTS
# ============================================================================

# Case lifecycle statuses
STATUS_CASE_CREATED = "CASE_CREATED"
STATUS_INTAKE_UPLOADED = "INTAKE_UPLOADED"
STATUS_UNREDACTED_UPLOADED = "UNREDACTED_UPLOADED"
STATUS_PROCESSING = "PROCESSING"
STATUS_REVIEW_READY = "REVIEW_READY"
STATUS_REVIEWING = "REVIEWING"
STATUS_APPLYING_REDACTIONS = "APPLYING_REDACTIONS"
STATUS_COMPLETED = "COMPLETED"
STATUS_CLOSED = "CLOSED"
STATUS_FAILED = "FAILED"

# Valid status transitions (optional - for validation)
VALID_STATUS_TRANSITIONS = {
    STATUS_CASE_CREATED: [STATUS_INTAKE_UPLOADED],
    STATUS_INTAKE_UPLOADED: [STATUS_UNREDACTED_UPLOADED],
    STATUS_UNREDACTED_UPLOADED: [STATUS_PROCESSING, STATUS_FAILED],
    STATUS_PROCESSING: [STATUS_REVIEW_READY, STATUS_FAILED],
    STATUS_REVIEW_READY: [STATUS_REVIEWING],
    STATUS_REVIEWING: [STATUS_APPLYING_REDACTIONS],
    STATUS_APPLYING_REDACTIONS: [STATUS_COMPLETED, STATUS_FAILED],
    STATUS_COMPLETED: [STATUS_CLOSED],
    STATUS_FAILED: [],  # Failed is terminal unless manually reset
    STATUS_CLOSED: []   # Closed is terminal
}


# ============================================================================
# GUIDELINES STATUS CONSTANTS
# ============================================================================

# Guideline statuses
GUIDELINE_STATUS_ACTIVE = "active"
GUIDELINE_STATUS_INACTIVE = "inactive"

# Guideline processing statuses
GUIDELINE_PROCESSING_PENDING = "pending"      # PDF uploaded, waiting for conversion
GUIDELINE_PROCESSING_PROCESSING = "processing"  # Currently being converted
GUIDELINE_PROCESSING_COMPLETED = "completed"   # JSON available, ready for review/activation
GUIDELINE_PROCESSING_FAILED = "failed"        # Conversion failed


# ============================================================================
# API CONFIGURATION
# ============================================================================

# Pre-signed URL expiration time (seconds)
PRESIGNED_URL_EXPIRATION = 300  # 5 minutes

# Maximum number of cases to return in list queries
MAX_CASES_PER_QUERY = 100

# CORS headers for API Gateway responses
CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',  # Update with specific domain in production
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
}


# ============================================================================
# FILE SIZE LIMITS
# ============================================================================

# Maximum file size for uploads (bytes)
MAX_UPLOAD_SIZE = 52428800  # 50 MB

# Maximum file size for intake forms (bytes)
MAX_INTAKE_FORM_SIZE = 10485760  # 10 MB


logger = logging.getLogger(__name__)
logger.info("Constants module loaded successfully")
logger.info(f"S3 Bucket: {S3_BUCKET_NAME}")
logger.info(f"DynamoDB Cases Table: {DYNAMODB_TABLE_NAME}")
logger.info(f"DynamoDB Guidelines Table: {DYNAMODB_GUIDELINES_TABLE_NAME}")
logger.info(f"Bedrock Lambda: {BEDROCK_LAMBDA_NAME}")
logger.info(f"AWS Region: {AWS_REGION}")