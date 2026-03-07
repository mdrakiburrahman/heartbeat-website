# Contributing

## How to use, on a Linux machine

1. Get a fresh new WSL machine up:

   ```powershell
   # Delete old WSL
   wsl --unregister Ubuntu-24.04

   # Create new WSL
   wsl --install -d Ubuntu-24.04
   ```

1. Clone the repo, and open VSCode in it:

   ```bash
   cd ~/

   git config --global user.name "Raki Rahman"
   git config --global user.email "mdrakiburrahman@gmail.com"
   git clone https://github.com/mdrakiburrahman/heartbeat-website.git

   cd heartbeat-website/
   code .
   ```

1. Run the bootstrapper script:

   ```bash
   GIT_ROOT=$(git rev-parse --show-toplevel)
   chmod +x ${GIT_ROOT}/contrib/bootstrap-dev-env.sh && ${GIT_ROOT}/contrib/bootstrap-dev-env.sh
   ```

1. Quick serve:

   ```bash
   npm run dev -- -p 3847
   ```

1. Build and serve the website in Production mode:

   ```bash
   export GIT_ROOT=$(git rev-parse --show-toplevel)
   rm -rf "${GIT_ROOT}/out"

   npm run build
   npm run serve
   ```

1. Deploy to Azure:

   ```bash
   export CONN_STRING="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net"
   
   az storage blob delete-batch -s '$web' --connection-string "$CONN_STRING"
   az storage blob upload-batch -d '$web' -s "${GIT_ROOT}/out" --connection-string "$CONN_STRING"
   ```

   [Browse](https://heartbeatspark.z9.web.core.windows.net/).