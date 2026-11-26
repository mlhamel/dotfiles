# OpenHands — setup automatique

`openhands.sh` met en place Agent Canvas (Docker) **entièrement configuré**,
sans intervention manuelle à chaque démarrage.

## Ce que `up` fait

1. **ACL** — donne rwx à l'utilisateur du conteneur (uid 10001) sur
   `~/src/github.com/mlhamel` (récursif + ACL par défaut, pour que les
   nouveaux fichiers héritent) et sur le dossier opencode persistant.
2. **Config** — écrit `~/.local/share/openhands/opencode-container.jsonc`
   si absent : provider Ollama → `http://host.docker.internal:11434/v1`,
   les 9 modèles de la passerelle épinglés (dont `glm-5.3-flash:cloud`,
   contexte 65536).
3. **Conteneur** — démarre `ghcr.io/openhands/agent-canvas:1.43.0` (détaché,
   nommé `openhands-canvas`), avec : projets montés, volume d'état
   `openhands-state` et dossier opencode persistant
   (`~/.local/share/openhands/opencode` → `/home/openhands/.opencode`, le
   binaire survit aux redémarrages).
4. **Config install** — copie la config dans le conteneur (`docker cp` +
   `chown`). Ce n'est deliberately pas un montage : monter le fichier
   dans `.config` rend ce dossier non inscriptible pour uid 10001 et
   agent-canvas refuse de démarrer (« Browser config directory is not
   writable »). La copie est refaite à chaque `up`, donc un conteneur
   recréé reçoit toujours la config courante.
5. **Binaire** — installe opencode dans le conteneur si absent (l'install
   atterrit dans le dossier persistant : coût unique).
6. **Santé** — attend que l'interface réponde, puis affiche un résumé.

## Usage

Depuis ce dépôt (ou après l'avoir copié dans `~/bin`, qui doit être dans
le PATH) :

```sh
openhands/openhands.sh            # up (défaut)
openhands/openhands.sh up         # idem — sûr à relancer, ne refait que ce qui manque
openhands/openhands.sh status     # conteneur + interface + binaire + config
openhands/openhands.sh down       # stoppe + supprime le conteneur (état et fichiers conservés)
openhands/openhands.sh restart    # down + up
openhands/openhands.sh help
```

Puis ouvre <http://localhost:8000/canvas>.

## Le seul réglage manuel (une fois, persistant)

Dans l'interface Canvas, une seule fois (le réglage vit dans le volume
`openhands-state`, il survit aux redémarrages) :

- Settings → Agent → Agent : **ACP** → Preset : **Custom**
- Command : `/home/openhands/.opencode/bin/opencode acp`
- Model : `ollama/glm-5.3-flash:cloud`

Ensuite, nouvelle conversation : l'agent ACP tourne sur GLM-5.3-Flash via
la passerelle Ollama. Vérifie avec le probe habituel (`which opencode;
opencode --version; …; what model are you running on…`).

## Ce qui persiste où

| Élément                          | Emplacement                                         | Survit à un redémarrage ?    |
| -------------------------------- | --------------------------------------------------- | ---------------------------- |
| État Canvas (dont le preset ACP) | volume Docker `openhands-state`                     | oui                          |
| Binaire opencode                 | `~/.local/share/openhands/opencode/bin/`            | oui (monté)                  |
| Config opencode conteneur        | `~/.local/share/openhands/opencode-container.jsonc` | oui (recopiée à chaque `up`) |
| Projets                          | `~/src/github.com/mlhamel`                          | oui (monté, ACL)             |

Pour forcer une réinstallation d'opencode : supprime
`~/.local/share/openhands/opencode` puis relance `openhands.sh up`.

## Limites connues

- Le preset ACP reste un réglage manuel unique dans l'interface (pas d'API
  stable pour le pré-remplir) ; tout le reste est automatique.
- L'agent ACP n'a pas accès à la config hôte (plugins, Director,
  permissions) — seulement au provider Ollama + GLM. C'est volontaire :
  les plugins ne sont pas installés dans le conteneur.
- La config embarquée utilise le schéma opencode **v1** (`provider` /
  `npm` / `options`) parce que le script d'install fournit opencode
  1.19.6. Si le binaire du conteneur passe un jour en 2.x, elle doit
  passer au schéma v2 (`providers` / `package` / `settings`).
- L'image est épinglée à `1.43.0` (variable `IMAGE` en tête du script).
  Pour monter de version, change la valeur et relance `up` (le conteneur
  sera recréé ; le binaire et la config persistent).
- Le script ne démarre pas Ollama : la passerelle systemd
  (`ollama.service`, `OLLAMA_HOST=0.0.0.0:11434`) doit déjà tourner.
- Premier lancement sur une machine : c'est le vrai test (les parties
  Docker ne sont pas couvertes par le harnais shell, qui tourne avec un
  `docker` factice).
