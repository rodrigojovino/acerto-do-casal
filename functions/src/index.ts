import { setGlobalOptions } from 'firebase-functions/v2';

// Todas as Functions rodam em São Paulo, perto do Firestore.
// maxInstances baixo limita o custo em caso de abuso.
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 5 });
