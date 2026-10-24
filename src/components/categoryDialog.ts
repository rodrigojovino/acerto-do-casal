import { alertController, modalController } from '@ionic/vue';
import { MAX_CATEGORY_NAME, categoryNameProblem, type Category } from '@/domain/categories';
import { createCategory } from '@/services/categories';
import CategorySheet from './CategorySheet.vue';

/**
 * Escolha da categoria ao salvar um gasto (com "Exigir categoria nos gastos"
 * ligada): painel por baixo da tela (`CategorySheet`), perto do polegar.
 * Devolve o id escolhido, ou `null` se a pessoa fechar (o gasto não é salvo).
 */
export async function chooseCategory(
  currentId: string | undefined,
  title = 'Categoria do gasto',
  saveLabel = 'Salvar gasto',
): Promise<string | null> {
  const sheet = await modalController.create({
    component: CategorySheet,
    componentProps: { currentId, title, saveLabel },
    breakpoints: [0, 1],
    initialBreakpoint: 1,
    cssClass: 'category-sheet',
  });
  await sheet.present();
  const { data, role } = await sheet.onDidDismiss<string | null>();
  return role === 'confirm' && data ? data : null;
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
