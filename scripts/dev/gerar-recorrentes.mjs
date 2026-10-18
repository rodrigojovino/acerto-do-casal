// Dispara a geração de recorrentes no EMULADOR, simulando o dia 1 de um mês.
// Uso: npm run recorrentes:gerar -- [YYYY-MM | YYYY-MM-DD]
//   sem argumento: dia 1 do mês atual (São Paulo)
//   YYYY-MM:       dia 1 desse mês (ex.: mês futuro)
//   YYYY-MM-DD:    esse dia (ex.: simular a execução diária no meio do mês)
// Exige `npm run emulators` rodando e as Functions compiladas (o próprio emulators compila).
// Nunca roda contra o projeto real: FIRESTORE_EMULATOR_HOST é sempre definido
// (o Admin SDK então só fala com o emulador).

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ||= 'acerto-do-casal';

const arg = process.argv[2];
const spToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
let today;
if (!arg) today = `${spToday.slice(0, 7)}-01`;
else if (/^\d{4}-(0[1-9]|1[0-2])$/.test(arg)) today = `${arg}-01`;
else if (/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(arg)) today = arg;
else {
  console.error(`Argumento inválido: "${arg}". Use YYYY-MM ou YYYY-MM-DD.`);
  process.exit(1);
}

const { generateRecurring } = await import('../../functions/lib/functions/src/recurring.js');
console.log(`Gerando recorrentes como se hoje fosse ${today} (emulador ${process.env.FIRESTORE_EMULATOR_HOST}, projeto ${process.env.GCLOUD_PROJECT})…`);
const report = await generateRecurring(today);
console.log(`Criados: ${report.created} · ignorados: ${report.skipped}`);
process.exit(0);
