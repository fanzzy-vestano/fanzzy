# CAPTCHA release notes

OTP CAPTCHA counts and challenges are stored in the dedicated
`fanzzy_otp_captcha_state_v1` table so separate Edge instances share them.
Only the service role can access this table and its RPC. Phone numbers, client
identifiers, CAPTCHA tokens and CAPTCHA answers are stored as keyed hashes.

State is valid for at most five minutes and stale rows are opportunistically
removed after ten minutes of inactivity. If the shared store is unavailable,
OTP sends fail closed rather than bypassing the CAPTCHA. Apply only the dedicated
CAPTCHA migration before deploying the updated customer-auth function.

The tests use isolated SMS stubs and make no production network requests. No
product or order data changes are included in this branch.
