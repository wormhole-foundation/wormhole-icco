import { ChainId } from "@certusone/wormhole-sdk";
import keccak256 from "keccak256";

const elliptic = require("elliptic");

export function signAndEncodeVaa(
  timestamp: number,
  nonce: number,
  emitterChainId: number,
  emitterAddress: Buffer,
  sequence: number,
  data: Buffer
): Buffer {
  if (emitterAddress.length != 32) {
    throw new Error("emitterAddress != 32 bytes");
  }

  // wormhole initialized with only one guardian in devnet
  const signers = ["cfb12303a19cde580bb4dd771639b0d26bc68353645571a8cff516ab2ee113a0"];

  const sigStart = 6;
  const numSigners = signers.length;
  const sigLength = 66;
  const bodyStart = sigStart + sigLength * numSigners;
  const bodyHeaderLength = 51;
  const vm = Buffer.alloc(bodyStart + bodyHeaderLength + data.length);

  // header
  const guardianSetIndex = 0;

  vm.writeUInt8(1, 0);
  vm.writeUInt32BE(guardianSetIndex, 1);
  vm.writeUInt8(numSigners, 5);

  // encode body with arbitrary consistency level
  const consistencyLevel = 1;

  vm.writeUInt32BE(timestamp, bodyStart);
  vm.writeUInt32BE(nonce, bodyStart + 4);
  vm.writeUInt16BE(emitterChainId, bodyStart + 8);
  vm.write(emitterAddress.toString("hex"), bodyStart + 10, "hex");
  vm.writeBigUInt64BE(BigInt(sequence), bodyStart + 42);
  vm.writeUInt8(consistencyLevel, bodyStart + 50);
  vm.write(data.toString("hex"), bodyStart + bodyHeaderLength, "hex");

  // signatures
  const hash = keccak256(keccak256(vm.subarray(bodyStart)));

  for (let i = 0; i < numSigners; ++i) {
    const ec = new elliptic.ec("secp256k1");
    const key = ec.keyFromPrivate(signers[i]);
    const signature = key.sign(hash, { canonical: true });

    const start = sigStart + i * sigLength;
    vm.writeUInt8(i, start);
    vm.write(signature.r.toString(16).padStart(64, "0"), start + 1, "hex");
    vm.write(signature.s.toString(16).padStart(64, "0"), start + 33, "hex");
    vm.writeUInt8(signature.recoveryParam, start + 65);
  }

  return vm;
}

export interface GuardianSignature {
  r: Buffer;
  s: Buffer;
  v: number;
}

export interface ParsedVaa {
  version: number;
  guardianSignatures: GuardianSignature[];
  timestamp: number;
  nonce: number;
  emitterChain: ChainId;
  emitterAddress: Buffer;
  sequence: bigint;
  consistencyLevel: number;
  data: Buffer;
  hash: Buffer;
}

export function parseVaa(signedVaa: Buffer): ParsedVaa {
  const sigStart = 6;
  const numSigners = signedVaa[5];
  const sigLength = 66;

  const guardianSignatures: GuardianSignature[] = [];
  for (let i = 0; i < numSigners; ++i) {
    const start = i * sigLength + 1;
    guardianSignatures.push({
      r: signedVaa.subarray(start, start + 32),
      s: signedVaa.subarray(start + 32, start + 64),
      v: signedVaa[start + 64],
    });
  }

  const body = signedVaa.subarray(sigStart + sigLength * numSigners);

  return {
    version: signedVaa[0],
    guardianSignatures,
    timestamp: body.readUint32BE(0),
    nonce: body.readUint32BE(4),
    emitterChain: body.readUint16BE(8) as ChainId,
    emitterAddress: body.subarray(10, 42),
    sequence: body.readBigUint64BE(42),
    consistencyLevel: body[50],
    data: body.subarray(51),
    hash: keccak256(body),
  };
}
