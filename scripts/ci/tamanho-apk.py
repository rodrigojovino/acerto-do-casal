"""Tamanho de cada parte de um APK (comprimido, como pesa no download).

Uso: python3 scripts/ci/tamanho-apk.py caminho/do/app.apk

No GitHub Actions, imprime também uma anotação (::notice::) com o resumo,
que aparece na página da execução e na API pública de check-runs.
"""
import collections
import os
import sys
import zipfile


def part(name: str) -> str:
    if name.startswith('lib/'):
        return 'bibliotecas nativas'
    if name.startswith('classes') and name.endswith('.dex'):
        return 'código (dex)'
    if name.startswith('assets/public/'):
        return 'app web'
    if name.startswith('assets/mlkit'):
        return 'modelos do leitor embutido'
    if name == 'resources.arsc':
        return 'resources.arsc'
    if name.startswith('res/'):
        return 'res'
    return 'outros'


def main(path: str) -> None:
    sizes = collections.Counter()
    libs = collections.Counter()
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            sizes[part(info.filename)] += info.compress_size
            if info.filename.startswith('lib/'):
                libs[info.filename.split('/')[-1]] += info.compress_size
    total = os.path.getsize(path)
    mb = lambda b: f'{b / 1e6:.2f} MB'
    lines = [f'APK: {mb(total)}'] + [f'{k}: {mb(v)}' for k, v in sizes.most_common()]
    print('\n'.join(lines))
    print('bibliotecas nativas (todas as arquiteturas): ' + ', '.join(f'{k} {mb(v)}' for k, v in libs.most_common()))
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        print('::notice title=Tamanho do APK::' + ' · '.join(lines))


if __name__ == '__main__':
    main(sys.argv[1])
