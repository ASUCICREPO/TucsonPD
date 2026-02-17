import json
import boto3
import logging
import urllib3
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize clients
cognito_client = boto3.client('cognito-idp')
http = urllib3.PoolManager()


def send_response(event, context, response_status, response_data, physical_resource_id=None):
    """Send response back to CloudFormation"""
    response_url = event['ResponseURL']
    
    response_body = {
        'Status': response_status,
        'Reason': f'See CloudWatch Log Stream: {context.log_stream_name}',
        'PhysicalResourceId': physical_resource_id or context.log_stream_name,
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'Data': response_data
    }
    
    json_response_body = json.dumps(response_body)
    
    headers = {
        'content-type': '',
        'content-length': str(len(json_response_body))
    }
    
    try:
        response = http.request('PUT', response_url, headers=headers, body=json_response_body)
        logger.info(f"CloudFormation response status: {response.status}")
    except Exception as e:
        logger.error(f"Failed to send response to CloudFormation: {str(e)}")


def lambda_handler(event, context):
    """
    CloudFormation Custom Resource Lambda to create default admin user.
    
    On Create: Creates admin user and adds to Admins group
    On Update: Does nothing (user already exists)
    On Delete: Optionally deletes the admin user
    
    Args:
        event: CloudFormation event
        context: Lambda context
    """
    logger.info(f"Event: {json.dumps(event, default=str)}")
    
    try:
        request_type = event['RequestType']
        resource_properties = event['ResourceProperties']
        
        user_pool_id = resource_properties['UserPoolId']
        admin_email = resource_properties['AdminEmail']
        admin_password = resource_properties['AdminPassword']
        admin_group = resource_properties.get('AdminGroup', 'Admins')
        
        if request_type == 'Create':
            logger.info("Creating default admin user")
            
            # Check if user already exists
            try:
                cognito_client.admin_get_user(
                    UserPoolId=user_pool_id,
                    Username=admin_email
                )
                logger.info(f"Admin user {admin_email} already exists")
                send_response(event, context, 'SUCCESS', {
                    'Message': 'Admin user already exists',
                    'Username': admin_email
                })
                return
                
            except cognito_client.exceptions.UserNotFoundException:
                logger.info(f"Admin user {admin_email} does not exist, creating...")
            
            # Create admin user
            create_response = cognito_client.admin_create_user(
                UserPoolId=user_pool_id,
                Username=admin_email,
                UserAttributes=[
                    {'Name': 'email', 'Value': admin_email},
                    {'Name': 'email_verified', 'Value': 'true'}
                ],
                TemporaryPassword=admin_password,
                MessageAction='SUPPRESS',  # Don't send email
                DesiredDeliveryMediums=['EMAIL']
            )
            
            logger.info(f"Created admin user: {admin_email}")
            
            # Set permanent password
            cognito_client.admin_set_user_password(
                UserPoolId=user_pool_id,
                Username=admin_email,
                Password=admin_password,
                Permanent=True
            )
            
            logger.info(f"Set permanent password for {admin_email}")
            
            # Add user to Admins group
            try:
                cognito_client.admin_add_user_to_group(
                    UserPoolId=user_pool_id,
                    Username=admin_email,
                    GroupName=admin_group
                )
                logger.info(f"Added {admin_email} to {admin_group} group")
            except ClientError as e:
                logger.error(f"Failed to add user to group: {str(e)}")
                # Continue anyway - user is created
            
            send_response(event, context, 'SUCCESS', {
                'Message': 'Admin user created successfully',
                'Username': admin_email,
                'Note': 'User created with permanent password'
            })
            
        elif request_type == 'Update':
            logger.info("Update request - no action needed")
            send_response(event, context, 'SUCCESS', {
                'Message': 'Update completed - admin user unchanged'
            })
            
        elif request_type == 'Delete':
            logger.info("Delete request - preserving admin user")
            # Optionally delete the user on stack deletion
            # Uncomment below to delete user when stack is destroyed
            
            # try:
            #     cognito_client.admin_delete_user(
            #         UserPoolId=user_pool_id,
            #         Username=admin_email
            #     )
            #     logger.info(f"Deleted admin user: {admin_email}")
            # except ClientError as e:
            #     logger.warning(f"Failed to delete user: {str(e)}")
            
            send_response(event, context, 'SUCCESS', {
                'Message': 'Delete completed - admin user preserved'
            })
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        send_response(event, context, 'FAILED', {
            'Error': str(e)
        })