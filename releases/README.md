# Paquets de Feature Studio

La version actuelle est **1.29.0** : [télécharger le VSIX](https://github.com/MattDevBzh/KerAI/releases/download/v1.29.0/feature-studio-1.29.0.vsix) et son [SHA256SUMS](https://github.com/MattDevBzh/KerAI/releases/download/v1.29.0/SHA256SUMS).

Elle ajoute le QG grand écran, les tableaux manuscrits des agents et la navigation documentée dans l’espace Applications. Le catalogue personnel, les compétences natives et les validations humaines sont conservés. [Notes de version](../docs/releases/v1.29.0.md).

Depuis la v1.4.0, les nouveaux paquets sont publiés dans les [releases GitHub](https://github.com/MattDevBzh/KerAI/releases/latest) après validation de la CI. Les VSIX et le fichier `SHA256SUMS` présents dans ce dossier concernent les versions historiques jusqu’à la v1.1.1 et restent conservés.

Dans VS Code, utilise **Extensions : Installer à partir du VSIX**, puis recharge la fenêtre et vérifie la version **1.29.0**. Compare l'empreinte du fichier téléchargé avec sa ligne dans le `SHA256SUMS` de la release : `shasum -a 256 feature-studio-1.29.0.vsix` sur macOS/Linux, ou `Get-FileHash .\feature-studio-1.29.0.vsix -Algorithm SHA256` sur Windows.

`npm run package` produit localement `releases/feature-studio-1.29.0.vsix`. Une construction locale possède sa propre empreinte ; le `SHA256SUMS` publié concerne les fichiers téléchargés depuis GitHub.

L’[icône Windows](https://github.com/MattDevBzh/KerAI/releases/download/v1.29.0/feature-studio.ico) est également jointe à la release et couverte par son `SHA256SUMS`.
