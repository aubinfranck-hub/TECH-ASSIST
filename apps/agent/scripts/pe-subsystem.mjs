// Change le « sous-système » d'un exécutable Windows : GUI (2) = aucune fenêtre noire, CONSOLE (3) = fenêtre de terminal.
// Utilisé par la fabrication du .exe (GitHub Actions) : sans outil Visual Studio, en modifiant seulement 2 octets de l'en-tête.
//   node pe-subsystem.mjs <fichier.exe> gui|console
import { closeSync, fstatSync, openSync, readSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SUBSYSTEM = { gui: 2, console: 3 };
const OPTIONAL_HEADER_SUBSYSTEM_OFFSET = 68; // identique pour PE32 et PE32+

/** Position (en octets) du champ « Subsystem » dans l'en-tête, ou une erreur si le fichier n'est pas un exécutable PE. */
export function subsystemOffset(head) {
  if (head.length < 0x40 || head[0] !== 0x4d || head[1] !== 0x5a) throw new Error("Ce fichier n'est pas un exécutable Windows (signature MZ absente).");
  const pe = head.readUInt32LE(0x3c);
  if (pe + 24 + OPTIONAL_HEADER_SUBSYSTEM_OFFSET + 2 > head.length) throw new Error('En-tête PE trop long ou tronqué.');
  if (head.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('Signature PE absente.');
  const magic = head.readUInt16LE(pe + 24);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error("Format d'en-tête optionnel inconnu.");
  return pe + 24 + OPTIONAL_HEADER_SUBSYSTEM_OFFSET;
}

export function readSubsystem(head) {
  return head.readUInt16LE(subsystemOffset(head));
}

/** Modifie le sous-système dans un tampon (en-tête) ; renvoie la position modifiée. */
export function setSubsystem(head, value) {
  const offset = subsystemOffset(head);
  head.writeUInt16LE(value, offset);
  return offset;
}

/** Modifie le fichier sur place (2 octets) et relit la valeur pour vérifier. */
export function patchFile(path, kind) {
  const value = SUBSYSTEM[kind];
  if (!value) throw new Error("Choisissez « gui » ou « console ».");
  const fd = openSync(path, 'r+');
  try {
    const size = Math.min(fstatSync(fd).size, 4096);
    const head = Buffer.alloc(size);
    readSync(fd, head, 0, size, 0);
    const offset = subsystemOffset(head);
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16LE(value);
    writeSync(fd, bytes, 0, 2, offset);
    const check = Buffer.alloc(2);
    readSync(fd, check, 0, 2, offset);
    if (check.readUInt16LE() !== value) throw new Error('La modification n’a pas été enregistrée.');
  } finally {
    closeSync(fd);
  }
  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [file, kind] = process.argv.slice(2);
  try {
    if (!file || !kind) throw new Error('Usage : node pe-subsystem.mjs <fichier.exe> gui|console');
    const value = patchFile(file, kind);
    console.log(`${file} : sous-système ${kind} (${value})`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
