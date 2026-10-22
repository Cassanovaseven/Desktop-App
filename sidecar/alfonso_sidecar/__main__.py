import os
import sys

import uvicorn

from .app import create_app


def main() -> None:
    token = os.environ.get("ALFONSO_SIDECAR_TOKEN")
    port = os.environ.get("ALFONSO_SIDECAR_PORT")
    if not token or not port:
        print("ALFONSO_SIDECAR_TOKEN dan ALFONSO_SIDECAR_PORT wajib diisi.", file=sys.stderr)
        sys.exit(2)
    uvicorn.run(create_app(token, vault_root=os.environ.get("ALFONSO_VAULT_ROOT")), host="127.0.0.1", port=int(port), log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
