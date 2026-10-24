import os
import sys

import uvicorn

from .app import HIGGSFIELD_URL, create_app


def main() -> None:
    token = os.environ.get("ALFONSO_SIDECAR_TOKEN")
    port = os.environ.get("ALFONSO_SIDECAR_PORT")
    if not token or not port:
        print("ALFONSO_SIDECAR_TOKEN dan ALFONSO_SIDECAR_PORT wajib diisi.", file=sys.stderr)
        sys.exit(2)
    app = create_app(
        token,
        vault_root=os.environ.get("ALFONSO_VAULT_ROOT"),
        models_root=os.environ.get("ALFONSO_MODELS_DIR"),
        # Hanya diisi proses utama saat tes e2e (server Higgsfield tiruan).
        higgsfield_url=os.environ.get("ALFONSO_HIGGSFIELD_URL") or HIGGSFIELD_URL,
    )
    uvicorn.run(app, host="127.0.0.1", port=int(port), log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
