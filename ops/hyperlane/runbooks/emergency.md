# Emergency Runbook

## Bridge incident

1. Disable the affected route in frontend config and redeploy the web app.
2. Pause the affected Hyperlane Warp Route if the deployed route supports pause controls.
3. Stop relayer processing for the affected token only.
4. Snapshot pending messages, route TVL, relayer balances, and contract events.
5. Resume only after admin multisig approval and a signed incident note.

## Swap incident

1. Remove the affected token from frontend config.
2. Set protocol fee controls to treasury-safe mode only if fee switch is involved.
3. Publish affected pair addresses and block numbers for LPs.
4. Do not migrate user funds automatically.

## RPC incident

1. Switch frontend and relayer to backup dedicated RPC.
2. Confirm `eth_chainId` equals `20250217`.
3. Confirm latest block is advancing and logs can be queried.
