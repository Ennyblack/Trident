# Logging and Observability

## Request IDs

Every inbound HTTP request to Trident is assigned a unique request ID (or inherits one from the inbound `X-Request-Id` header if supplied by the client/proxy). 

- **Response Header**: The request ID is always echoed back in the response under the `X-Request-Id` header (including on error responses).
- **Structured Logs**: The request ID is automatically included as a field (`request_id`) on every structured log line produced during the request lifecycle.
- **OTel Spans**: The request ID is recorded as an OpenTelemetry span attribute (`trident.request_id`).
- **Audit Logs**: The request ID is recorded in the database `audit_log` table alongside the key ID.

### Support Guideline
When reporting issues or failures to support, please provide the `X-Request-Id` response header value to quickly locate the exact request traces, logs, and audit entries.