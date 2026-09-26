#!/usr/bin/env node
// datum-keygen — generate a fresh seller wallet locally.
//
// The key and mnemonic print ONLY to your terminal, once. Store the key as
// DATUM_SIGNER_KEY in your local environment (0600 file or your client's env
// block). Never paste it into chat, a prompt, or a document.
//
// Selling on Datum requires a wallet key as identity — signing is free (no
// gas, no DTM). This wallet receives your sale proceeds, so keep it safe.

const { Wallet } = require('ethers');

const w = Wallet.createRandom();

console.log('================================================');
console.log('  DATUM seller wallet — save these offline now');
console.log('  The key below prints once and only here.');
console.log('================================================');
console.log('');
console.log('ADDRESS:     ' + w.address);
console.log('');
console.log('PRIVATE KEY: ' + w.privateKey);
console.log('');
console.log('MNEMONIC:    ' + w.mnemonic.phrase);
console.log('');
console.log('================================================');
console.log('Next: store the private key as DATUM_SIGNER_KEY');
console.log('(env or 0600 file). Never paste it in chat.');
console.log('This address receives your DTM sale proceeds.');
console.log('================================================');
