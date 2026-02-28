"""
Database Management Lambda - Main Handler

This Lambda handles all API Gateway requests from the frontend, managing:
- Case CRUD operations
- Pre-signed URL generation for S3 uploads/downloads
- Redaction guidelines management (admin)
- Triggering the Bedrock Processing Lambda

API Endpoints:
- POST   /cases                          → Create new case
- GET    /cases/{case_id}                → Get case details
- GET    /cases                          → List cases (filtered by officer_id or status)
- PUT    /cases/{case_id}/status         → Update case status (may trigger Bedrock Lambda)
- PUT    /cases/{case_id}/s3-path        → Update S3 path for uploaded file
- DELETE /cases/{case_id}                → Delete case
- POST   /presigned-url/upload           → Generate pre-signed upload URL
- POST   /presigned-url/download         → Generate pre-signed download URL
- POST   /guidelines/upload              → Get pre-signed URL for guidelines PDF upload (admin)
- POST   /guidelines/{guideline_id}/process → Trigger PDF→JSON conversion (admin)
- GET    /guidelines/all                 → List all guidelines with metadata (admin)
- GET    /guidelines/active              → Get active guidelines
- PUT    /guidelines/{guideline_id}/activate → Set guideline as active (admin)
- PUT    /guidelines/{guideline_id}      → Update guideline JSON after review (admin)
- DELETE /guidelines/{guideline_id}      → Delete guideline (admin)
"""

import json
import logging
from typing import Dict, Any

from case_management import (
    create_case,
    get_case,
    list_cases,
    update_case_status,
    update_case_s3_path,
    delete_case
)
from presigned_urls import (
    generate_upload_url,
    generate_download_url
)
from guidelines_management import (
    create_guideline,
    list_all_guidelines,
    get_active_guideline,
    update_guideline_json,
    activate_guideline,
    delete_guideline,
    trigger_guideline_conversion
)
from utils import build_api_response, parse_request_body
import constants  # This configures logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler - routes API Gateway requests to appropriate handlers
    
    Args:
        event: API Gateway event payload
        context: Lambda context object
        
    Returns:
        API Gateway response with statusCode, headers, and body
    """
    
    logger.info(f"Received event: {json.dumps(event)}")
    
    try:
        # Extract HTTP method and path
        http_method = event.get('httpMethod', '')
        path = event.get('path', '')
        path_parameters = event.get('pathParameters') or {}
        query_parameters = event.get('queryStringParameters') or {}
        
        # Extract officer identity — try Cognito authorizer first, fall back to
        # query params or request body (API Gateway has no authorizer configured;
        # identity is passed explicitly by the authenticated frontend)
        authorizer_claims = event.get('requestContext', {}).get('authorizer', {}).get('claims', {})
        officer_id = authorizer_claims.get('sub')
        officer_name = authorizer_claims.get('name', 'Unknown Officer')
        is_admin = 'admin' in authorizer_claims.get('cognito:groups', '').lower()

        if not officer_id:
            # Read identity from query params (GET requests) or request body (POST/PUT)
            officer_id = query_parameters.get('officer_id')
            if not officer_id and event.get('body'):
                try:
                    body_peek = parse_request_body(event)
                    officer_id = body_peek.get('officer_id')
                    officer_name = body_peek.get('officer_name', officer_name)
                    is_admin = body_peek.get('is_admin', is_admin)
                except Exception:
                    pass

        if not officer_id:
            logger.warning("Request received with no officer_id")
            return build_api_response(401, {
                "error": "Unauthorized",
                "message": "officer_id is required"
            }, error=True)
        
        logger.info(f"Request: {http_method} {path}")
        logger.info(f"Officer ID: {officer_id}, Is Admin: {is_admin}")
        
        # ====================================================================
        # ROUTE TO APPROPRIATE HANDLER
        # ====================================================================
        
        # POST /cases - Create new case
        if http_method == 'POST' and path == '/cases':
            return handle_create_case(officer_id, officer_name)
        
        # GET /cases/{case_id} - Get case details
        elif http_method == 'GET' and path.startswith('/cases/') and path_parameters.get('case_id'):
            case_id = path_parameters['case_id']
            return handle_get_case(case_id, officer_id)
        
        # GET /cases - List cases
        elif http_method == 'GET' and path == '/cases':
            status_filter = query_parameters.get('status')
            limit = int(query_parameters.get('limit', 50))
            exclude_officer_id = query_parameters.get('exclude_officer_id')
            return handle_list_cases(officer_id, status_filter, limit, exclude_officer_id)
        
        # PUT /cases/{case_id}/status - Update case status
        elif http_method == 'PUT' and path.endswith('/status') and path_parameters.get('case_id'):
            case_id = path_parameters['case_id']
            body = parse_request_body(event)
            return handle_update_status(case_id, body, officer_id)
        
        # PUT /cases/{case_id}/s3-path - Update S3 path
        elif http_method == 'PUT' and path.endswith('/s3-path') and path_parameters.get('case_id'):
            case_id = path_parameters['case_id']
            body = parse_request_body(event)
            return handle_update_s3_path(case_id, body, officer_id)
        
        # DELETE /cases/{case_id} - Delete case
        elif http_method == 'DELETE' and path.startswith('/cases/') and path_parameters.get('case_id'):
            case_id = path_parameters['case_id']
            return handle_delete_case(case_id, officer_id)
        
        # POST /presigned-url/upload - Generate upload URL
        elif http_method == 'POST' and path == '/presigned-url/upload':
            body = parse_request_body(event)
            return handle_generate_upload_url(body, officer_id)
        
        # POST /presigned-url/download - Generate download URL
        elif http_method == 'POST' and path == '/presigned-url/download':
            body = parse_request_body(event)
            return handle_generate_download_url(body, officer_id)
        
        # ====================================================================
        # GUIDELINES MANAGEMENT ENDPOINTS
        # ====================================================================
        
        # POST /guidelines/upload - Get pre-signed URL for PDF upload (admin only)
        elif http_method == 'POST' and path == '/guidelines/upload':
            if not is_admin:
                return build_api_response(403, {"error": "Forbidden", "message": "Admin access required"}, error=True)
            body = parse_request_body(event)
            return handle_create_guideline(body, officer_id, officer_name)
        
        # POST /guidelines/{guideline_id}/process - Trigger conversion (admin only)
        elif http_method == 'POST' and path.endswith('/process') and path_parameters.get('guideline_id'):
            if not is_admin:
                return build_api_response(403, {"error": "Forbidden", "message": "Admin access required"}, error=True)
            guideline_id = path_parameters['guideline_id']
            return handle_trigger_conversion(guideline_id, officer_id)
        
        # GET /guidelines/all - List all guidelines (admin only)
        elif http_method == 'GET' and path == '/guidelines/all':
            if not is_admin:
                return build_api_response(403, {"error": "Forbidden", "message": "Admin access required"}, error=True)
            return handle_list_all_guidelines()
        
        # GET /guidelines/active - Get active guidelines (all users)
        elif http_method == 'GET' and path == '/guidelines/active':
            return handle_get_active_guideline()
        
        # PUT /guidelines/{guideline_id}/activate - Activate guideline (admin only)
        elif http_method == 'PUT' and path.endswith('/activate') and path_parameters.get('guideline_id'):
            if not is_admin:
                return build_api_response(403, {"error": "Forbidden", "message": "Admin access required"}, error=True)
            guideline_id = path_parameters['guideline_id']
            return handle_activate_guideline(guideline_id, officer_id)
        
        # PUT /guidelines/{guideline_id} - Update guideline JSON (admin only)
        elif http_method == 'PUT' and path.startswith('/guidelines/') and path_parameters.get('guideline_id'):
            if not is_admin:
                return build_api_response(403, {"error": "Forbidden", "message": "Admin access required"}, error=True)
            guideline_id = path_parameters['guideline_id']
            body = parse_request_body(event)
            return handle_update_guideline(guideline_id, body, officer_id)
        
        # DELETE /guidelines/{guideline_id} - Delete guideline (admin only)
        elif http_method == 'DELETE' and path.startswith('/guidelines/') and path_parameters.get('guideline_id'):
            if not is_admin:
                return build_api_response(403, {"error": "Forbidden", "message": "Admin access required"}, error=True)
            guideline_id = path_parameters['guideline_id']
            return handle_delete_guideline(guideline_id, officer_id)
        
        # Unknown endpoint
        else:
            logger.warning(f"Unknown endpoint: {http_method} {path}")
            return build_api_response(404, {"error": "Not Found", "message": f"Endpoint not found: {http_method} {path}"}, error=True)
    
    except ValueError as e:
        # Validation errors (400)
        logger.error(f"Validation error: {str(e)}")
        return build_api_response(400, {"error": "Bad Request", "message": str(e)}, error=True)
    
    except PermissionError as e:
        # Authorization errors (403)
        logger.error(f"Permission error: {str(e)}")
        return build_api_response(403, {"error": "Forbidden", "message": str(e)}, error=True)
    
    except Exception as e:
        # Unexpected errors (500)
        logger.error(f"Unexpected error: {str(e)}", exc_info=True)
        return build_api_response(500, {"error": "Internal Server Error", "message": "An unexpected error occurred"}, error=True)


# ============================================================================
# HANDLER FUNCTIONS
# ============================================================================

def handle_create_case(officer_id: str, officer_name: str) -> Dict[str, Any]:
    """Handle POST /cases - Create new case"""
    logger.info(f"Creating new case for officer: {officer_id}")
    
    case = create_case(officer_id, officer_name)
    
    return build_api_response(201, {
        "success": True,
        "message": "Case created successfully",
        "case": case
    })


def handle_get_case(case_id: str, officer_id: str) -> Dict[str, Any]:
    """Handle GET /cases/{case_id} - Get case details"""
    logger.info(f"Getting case: {case_id}")
    
    case = get_case(case_id)
    
    # Verify officer owns this case (security check)
    if case['officer_id'] != officer_id:
        raise PermissionError("You do not have permission to access this case")
    
    return build_api_response(200, {
        "success": True,
        "case": case
    })


def handle_list_cases(officer_id: str, status_filter: str, limit: int, exclude_officer_id: str = None) -> Dict[str, Any]:
    """Handle GET /cases - List cases"""
    logger.info(f"Listing cases for officer: {officer_id}, status filter: {status_filter}, exclude: {exclude_officer_id}")
    
    cases = list_cases(officer_id=officer_id, status=status_filter, limit=limit, exclude_officer_id=exclude_officer_id)
    
    return build_api_response(200, {
        "success": True,
        "count": len(cases),
        "cases": cases
    })


def handle_update_status(case_id: str, body: Dict[str, Any], officer_id: str) -> Dict[str, Any]:
    """Handle PUT /cases/{case_id}/status - Update case status"""
    logger.info(f"Updating status for case: {case_id}")
    
    # Validate request body
    if 'status' not in body:
        raise ValueError("Missing 'status' field in request body")
    
    new_status = body['status']
    metadata = body.get('metadata', {})
    
    # Verify officer owns this case
    case = get_case(case_id)
    if case['officer_id'] != officer_id:
        raise PermissionError("You do not have permission to update this case")
    
    # Update status (this may trigger Bedrock Lambda)
    updated_case = update_case_status(case_id, new_status, metadata)
    
    return build_api_response(200, {
        "success": True,
        "message": "Case status updated successfully",
        "case": updated_case
    })


def handle_update_s3_path(case_id: str, body: Dict[str, Any], officer_id: str) -> Dict[str, Any]:
    """Handle PUT /cases/{case_id}/s3-path - Update S3 path"""
    logger.info(f"Updating S3 path for case: {case_id}")
    
    # Validate request body
    if 'path_type' not in body or 's3_path' not in body:
        raise ValueError("Missing 'path_type' or 's3_path' in request body")
    
    path_type = body['path_type']
    s3_path = body['s3_path']
    
    # Verify officer owns this case
    case = get_case(case_id)
    if case['officer_id'] != officer_id:
        raise PermissionError("You do not have permission to update this case")
    
    # Update S3 path
    updated_case = update_case_s3_path(case_id, path_type, s3_path)
    
    return build_api_response(200, {
        "success": True,
        "message": "S3 path updated successfully",
        "case": updated_case
    })


def handle_generate_upload_url(body: Dict[str, Any], officer_id: str) -> Dict[str, Any]:
    """Handle POST /presigned-url/upload - Generate upload URL"""
    logger.info("Generating pre-signed upload URL")
    
    # Validate request body
    if 'case_id' not in body or 'file_type' not in body:
        raise ValueError("Missing 'case_id' or 'file_type' in request body")
    
    case_id = body['case_id']
    file_type = body['file_type']
    
    # Verify officer owns this case
    case = get_case(case_id)
    if case['officer_id'] != officer_id:
        raise PermissionError("You do not have permission to upload to this case")
    
    # Generate pre-signed URL
    url_data = generate_upload_url(case_id, file_type)
    
    return build_api_response(200, {
        "success": True,
        "upload_url": url_data['url'],
        "fields": url_data.get('fields', {}),
        "s3_path": url_data['s3_path']
    })


def handle_generate_download_url(body: Dict[str, Any], officer_id: str) -> Dict[str, Any]:
    """Handle POST /presigned-url/download - Generate download URL"""
    logger.info("Generating pre-signed download URL")
    
    # Validate request body
    if 'case_id' not in body or 'file_type' not in body:
        raise ValueError("Missing 'case_id' or 'file_type' in request body")
    
    case_id = body['case_id']
    file_type = body['file_type']
    
    # Verify case exists (no ownership check — officers can view each other's work)
    get_case(case_id)
    
    # Generate pre-signed URL
    download_url = generate_download_url(case_id, file_type)
    
    return build_api_response(200, {
        "success": True,
        "download_url": download_url
    })


def handle_delete_case(case_id: str, officer_id: str) -> Dict[str, Any]:
    """Handle DELETE /cases/{case_id} - Delete case"""
    logger.info(f"Deleting case: {case_id}")
    
    # Verify officer owns this case
    case = get_case(case_id)
    if case['officer_id'] != officer_id:
        raise PermissionError("You do not have permission to delete this case")
    
    # Delete the case
    delete_case(case_id)
    
    return build_api_response(200, {
        "success": True,
        "message": "Case deleted successfully",
        "case_id": case_id
    })


# ============================================================================
# GUIDELINES HANDLER FUNCTIONS
# ============================================================================

def handle_create_guideline(body: Dict[str, Any], admin_id: str, admin_name: str) -> Dict[str, Any]:
    """Handle POST /guidelines/upload - Create guideline and get upload URL"""
    logger.info(f"Creating new guideline by admin: {admin_id}")
    
    # Validate request body
    if 'description' not in body:
        raise ValueError("Missing 'description' in request body")
    
    description = body['description']
    
    # Create guideline record and get pre-signed URL
    result = create_guideline(admin_id, admin_name, description)
    
    return build_api_response(201, {
        "success": True,
        "message": "Guideline created successfully",
        "guideline_id": result['guideline_id'],
        "upload_url": result['upload_url'],
        "fields": result.get('fields', {}),
        "version": result['version']
    })


def handle_trigger_conversion(guideline_id: str, admin_id: str) -> Dict[str, Any]:
    """Handle POST /guidelines/{guideline_id}/process - Trigger PDF→JSON conversion"""
    logger.info(f"Triggering conversion for guideline: {guideline_id}")
    
    # Trigger conversion (invokes Bedrock Lambda)
    result = trigger_guideline_conversion(guideline_id)
    
    return build_api_response(200, {
        "success": True,
        "message": "Guideline conversion triggered",
        "guideline_id": guideline_id,
        "processing_status": result['processing_status']
    })


def handle_list_all_guidelines() -> Dict[str, Any]:
    """Handle GET /guidelines/all - List all guidelines"""
    logger.info("Listing all guidelines")
    
    guidelines = list_all_guidelines()
    
    return build_api_response(200, {
        "success": True,
        "count": len(guidelines['guidelines']),
        "active_guideline_id": guidelines['active_guideline_id'],
        "guidelines": guidelines['guidelines']
    })


def handle_get_active_guideline() -> Dict[str, Any]:
    """Handle GET /guidelines/active - Get active guidelines"""
    logger.info("Retrieving active guideline")
    
    active_guideline = get_active_guideline()
    
    if not active_guideline:
        return build_api_response(404, {
            "error": "Not Found",
            "message": "No active guideline set"
        }, error=True)
    
    return build_api_response(200, {
        "success": True,
        "guideline": active_guideline
    })


def handle_activate_guideline(guideline_id: str, admin_id: str) -> Dict[str, Any]:
    """Handle PUT /guidelines/{guideline_id}/activate - Activate guideline"""
    logger.info(f"Activating guideline: {guideline_id}")
    
    result = activate_guideline(guideline_id, admin_id)
    
    return build_api_response(200, {
        "success": True,
        "message": "Guideline activated successfully",
        "guideline_id": guideline_id,
        "version": result['version']
    })


def handle_update_guideline(guideline_id: str, body: Dict[str, Any], admin_id: str) -> Dict[str, Any]:
    """Handle PUT /guidelines/{guideline_id} - Update guideline JSON after review"""
    logger.info(f"Updating guideline JSON: {guideline_id}")
    
    # Validate request body
    if 'guidelines_json' not in body:
        raise ValueError("Missing 'guidelines_json' in request body")
    
    guidelines_json = body['guidelines_json']
    
    result = update_guideline_json(guideline_id, guidelines_json, admin_id)
    
    return build_api_response(200, {
        "success": True,
        "message": "Guideline updated successfully",
        "guideline_id": guideline_id,
        "version": result['version']
    })


def handle_delete_guideline(guideline_id: str, admin_id: str) -> Dict[str, Any]:
    """Handle DELETE /guidelines/{guideline_id} - Delete guideline"""
    logger.info(f"Deleting guideline: {guideline_id}")
    
    delete_guideline(guideline_id)
    
    return build_api_response(200, {
        "success": True,
        "message": "Guideline deleted successfully",
        "guideline_id": guideline_id
    })