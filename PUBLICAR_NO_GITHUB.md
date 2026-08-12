# Como publicar o SocialFlow gratuitamente no GitHub Pages

## 1. Extraia o arquivo ZIP

Extraia todo o conteúdo para uma pasta chamada `socialflow-tcc`. Não apague a
pasta oculta `.github`, pois ela contém a publicação automática.

## 2. Crie o repositório

1. Entre em [github.com](https://github.com).
2. Clique em **New repository**.
3. Use o nome `socialflow-tcc` — outro nome também funciona.
4. Selecione **Public**.
5. Não marque as opções para criar README, licença ou `.gitignore`.
6. Clique em **Create repository**.

## 3. Envie os arquivos

Abra um terminal dentro da pasta extraída e execute os comandos abaixo,
substituindo `SEU_USUARIO` pelo seu nome de usuário no GitHub:

```bash
git init
git add .
git commit -m "Publicar SocialFlow TCC"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/socialflow-tcc.git
git push -u origin main
```

Se você escolher outro nome para o repositório, altere apenas o endereço do
comando `git remote add origin`. A configuração do site detecta o nome
automaticamente.

## 4. Ative o GitHub Pages

1. Abra o repositório no GitHub.
2. Acesse **Settings**.
3. No menu lateral, clique em **Pages**.
4. Em **Build and deployment**, escolha **GitHub Actions** como fonte.
5. Abra a aba **Actions** e aguarde o processo chamado
   **Publicar SocialFlow no GitHub Pages** ficar verde.

## 5. Abra o site

O endereço será parecido com:

```text
https://SEU_USUARIO.github.io/socialflow-tcc/
```

O primeiro envio pode levar alguns minutos. Depois disso, toda alteração enviada
para a branch `main` publicará uma nova versão automaticamente.

## Solução rápida de problemas

- **A página aparece sem estilo:** confirme que a Action terminou sem erro e
  recarregue usando `Ctrl + F5`.
- **Erro 404:** confira se o GitHub Pages está usando **GitHub Actions** e se o
  repositório é público.
- **A Action não começou:** abra **Actions**, selecione o fluxo e use
  **Run workflow**.
- **O comando git não existe:** instale o Git ou use o GitHub Desktop para
  publicar a pasta.

