import { alertController } from '@ionic/vue';
import { MAX_CATEGORY_NAME, categoryNameProblem, choosableCategories, type Category } from '@/domain/categories';
import { createCategory } from '@/services/categories';

/**
 * Janela de escolha da categoria ao salvar um gasto (com "Exigir categoria
 * nos gastos" ligada): as ativas, na ordem do casal, com a atual marcada, e
 * "Nova categoria" para criar sem sair do lançamento. Devolve o id escolhido,
 * ou `null` se a pessoa desistir (o gasto não é salvo).
 */
export async function chooseCategory(
  categories: readonly Category[],
  currentId: string | undefined,
  header = 'Categoria do gasto',
): Promise<string | null> {
  const options = choosableCategories(categories, currentId);
  const help = options.length === 0 ? 'Nenhuma categoria cadastrada ainda: crie a primeira.' : 'Escolha a categoria para salvar.';
  const alert = await alertController.create({
    header,
    message: help,
    inputs: options.map((c) => ({
      type: 'radio' as const,
      label: c.active ? c.name : `${c.name} (desativada)`,
      value: c.id,
      checked: c.id === currentId,
    })),
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: 'Nova categoria', role: 'new' },
      {
        text: 'Salvar',
        role: 'confirm',
        handler: (value: string | undefined) => {
          if (value) return true;
          alert.message = options.length === 0 ? help : 'Escolha uma categoria para salvar o gasto.';
          return false;
        },
      },
    ],
  });
  await alert.present();
  const { role, data } = await alert.onDidDismiss<{ values: string | undefined }>();
  if (role === 'new') {
    const created = await askNewCategory(categories);
    // Criada: já vale para este gasto. Desistiu da nova: volta para a escolha.
    return created ?? chooseCategory(categories, currentId, header);
  }
  return role === 'confirm' && data?.values ? data.values : null;
}

/**
 * Nome de uma categoria nova (no fim da lista). Devolve o id criado, ou `null`.
 * Usado na janela de escolha e em Ajustes › Categorias.
 */
export async function askNewCategory(categories: readonly Category[]): Promise<string | null> {
  const name = await askCategoryName('Nova categoria', '', categories);
  return name ? createCategory(name) : null;
}

/** Pede um nome válido (não vazio, sem repetir outra categoria). `null` se a pessoa desistir. */
export async function askCategoryName(
  header: string,
  value: string,
  categories: readonly Category[],
  exceptId?: string,
): Promise<string | null> {
  const alert = await alertController.create({
    header,
    inputs: [{ name: 'name', type: 'text', value, placeholder: 'Ex.: Farmácia', attributes: { maxlength: MAX_CATEGORY_NAME } }],
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      {
        text: 'Salvar',
        role: 'confirm',
        handler: (values: { name?: string }) => {
          const problem = categoryNameProblem(values.name ?? '', categories, exceptId);
          if (!problem) return true;
          alert.message = problem;
          return false;
        },
      },
    ],
  });
  await alert.present();
  const { role, data } = await alert.onDidDismiss<{ values: { name?: string } }>();
  const name = data?.values?.name?.trim();
  return role === 'confirm' && name ? name : null;
}
