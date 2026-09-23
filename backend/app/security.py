"""Bound mutation payloads before parsing and keep private responses out of caches."""
from starlette.responses import JSONResponse


class RequestSafety:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        if scope['method'] in ('POST', 'PUT', 'PATCH', 'DELETE'):
            chunks, size = [], 0
            while True:
                message = await receive()
                if message['type'] == 'http.disconnect': return
                part = message.get('body', b'')
                size += len(part)
                if size > 1024 * 1024:
                    return await JSONResponse({'detail':'Request too large.'}, status_code=413)(scope, receive, send)
                chunks.append(part)
                if not message.get('more_body', False): break
            body = b''.join(chunks)
            original_receive = receive
            delivered = False
            async def replay():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {'type':'http.request', 'body':body, 'more_body':False}
                return await original_receive()
            receive = replay
        async def private_send(message):
            if message['type'] == 'http.response.start':
                message['headers'] = list(message.get('headers', [])) + [
                    (b'cache-control', b'no-store'), (b'x-content-type-options', b'nosniff'),
                    (b'referrer-policy', b'no-referrer'),
                ]
            await send(message)
        await self.app(scope, receive, private_send)
