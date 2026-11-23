# CAPTCHA release notes

This branch contains the OTP CAPTCHA implementation and its sign-in interface.
It is a review branch and must not be deployed to production as it stands.

The CAPTCHA counter and challenge state are stored in the memory of an individual
server instance. Separate Supabase Edge instances do not share that state, so the
fifth OTP attempt can bypass the CAPTCHA or a valid challenge can become invalid
when requests reach different instances. A shared, expiring store is needed before
the feature can reliably enforce the limit in production.

The tests use isolated SMS stubs and make no production network requests. No
database migrations or product or order data changes are included in this branch.
