import { setGlobalOptions } from 'firebase-functions/v2';

// Módulo próprio para rodar antes de qualquer definição de Function: com ESM,
// os imports são avaliados antes do corpo de quem importa.
// Todas as Functions rodam em São Paulo, perto do Firestore.
// maxInstances baixo limita o custo em caso de abuso.
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 5 });
