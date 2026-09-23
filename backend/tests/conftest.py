import os
# Existing single-user regression fixtures remain explicit local-mode tests.
# Security tests override this and use real request-scoped authentication.
os.environ['FLOWLIST_AUTH_MODE'] = 'local'
os.environ['FLOWLIST_ENV'] = 'test'
