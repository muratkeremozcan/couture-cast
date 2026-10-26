#!/usr/bin/env bash
# The native lane needs a hardware-accelerated Linux VM for its local Auth stack.
set -euo pipefail
if [ "$(uname -m)" != x86_64 ]; then
  echo '::error::iOS original-resource CI requires the macos-15-intel runner.' >&2
  exit 1
fi
if ! hvf="$(sysctl -n kern.hv_support)" || [ "$hvf" != 1 ]; then
  echo '::error::iOS local Auth requires hardware virtualization; software emulation is unsupported.' >&2
  exit 1
fi
brew install colima docker qemu xcodegen lima-additional-guestagents coreutils
colima start --vm-type=qemu --arch=x86_64 --cpu-type=host --cpu=2 --memory=3 --disk=40
