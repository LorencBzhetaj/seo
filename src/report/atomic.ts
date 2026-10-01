import fs from 'node:fs';
import path from 'node:path';

/**
 * Shkrim atomik: skedar i përkohshëm në të njëjtën dosje, pastaj rename. Nëse procesi ndalet në mes
 * (p.sh. auditi anulohet nga dashboard-i), s'mbetet raport i cunguar me emrin përfundimtar —
 * mbetet vetëm një `.tmp` që s'lexohet si raport.
 */
export function writeFileAtomic(file: string, data: string): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}
