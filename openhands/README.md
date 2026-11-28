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
   contexte et sortie limités à 65536 tokens — opencode 1.19.6 exige les
   deux clés `limit.context` et `limit.output`).
3. **Conteneur** — démarre `ghcr.io/openhands/agent-canvas:1.43.0` (détaché,
   nommé `openhands-canvas`), avec : projets montés, volume d'état
   `openhands-state` et dossier opencode persistant
   (`~/.local/share/openhands/opencode` → `/home/openhands/.opencode`, le
   binaire survit aux redémarrages).
4. **Config install** — copie la config dans le conteneur (`mkdir -p` +
   `docker cp` + `chown`). Ce n'est volontairement pas un montage :
   monter le fichier dans `.config` rend ce dossier non inscriptible
   pour uid 10001 et agent-canvas refuse de démarrer (« Browser config
   directory is not writable »). La copie est refaite à chaque `up`,
   donc un conteneur recréé reçoit toujours la config courante. Le
   `mkdir -p` est nécessaire : un conteneur frais n'a pas encore de
   `.config/opencode/` (opencode le crée au premier lancement). Si le
   dépôt est adjacent au script (checkout normal), les règles globales
   (`AGENTS.md`, dont « plan d'abord ») et les skills sont copiées dans
   le même dossier : l'agent ACP les lit comme un agent hôte. L'arbre
   des skills est effacé puis recopié, pour que les suppressions de
   skills côté dépôt se propagent.
5. **Profils** — sème quatre profils d'agent opencode dans le conteneur
   (`opencode-build`, `opencode-ask`, `opencode-plan`, `opencode-review`),
   chacun épinglant son mode de session ACP : présents, ils sont
   conservés (les modifications faites dans l'UI survivent) ; absents,
   ils sont écrits depuis les définitions canoniques ; le preset
   générique `opencode-acp` est retiré.
6. **Binaire** — installe opencode dans le conteneur si absent (l'install
   atterrit dans le dossier persistant : coût unique).
7. **Santé** — attend que l'interface réponde, puis affiche un résumé.

## Usage

Depuis ce dépôt (ou après l'avoir copié dans `~/bin`, qui doit être dans
le PATH) :

```sh
openhands/openhands.sh            # up (défaut)
openhands/openhands.sh up         # idem — sûr à relancer, ne refait que ce qui manque
openhands/openhands.sh status     # conteneur + interface + binaire + config + règles
openhands/openhands.sh down       # stoppe + supprime le conteneur (état et fichiers conservés)
openhands/openhands.sh restart    # down + up
openhands/openhands.sh help
```

Puis ouvre <http://localhost:8000/canvas>.

## Le réglage ACP automatiquement épinglé (persistant)

Canvas n'expose pas de sélecteur de mode ACP ; le mode de session dérive
du profil d'agent sélectionné (`acp_session_mode`). `up` sème donc un
profil opencode par mode, directement dans le volume `openhands-state`
(`/home/openhands/.openhands/agent-profiles/`) :

- `opencode-build` — l'agent intégré, seul profil qui peut éditer
- `opencode-ask` — lecture seule, réponses simples
- `opencode-plan` — prépare un plan sans rien modifier
- `opencode-review` — revue de code par Kimi (aussi sous-agent via `@review`)

Tous pointent sur Command : `/home/openhands/.opencode/bin/opencode acp`
et Model : `ollama/glm-5.3-flash:cloud` — plus aucun réglage manuel.
Ensuite, nouvelle conversation : l'agent opencode tourne sur GLM-5.3-Flash
via la passerelle Ollama, avec le mode de session du profil choisi.
Vérifie avec le probe habituel (`which opencode; opencode --version; …;
what model are you running on…`).

Les agents de mode recopiés dans le conteneur (`opencode/agents/` à
chaque `up`) portent les mêmes noms : **Ask**, **Plan**, **Build** et
**Review** — choisir le profil choisit le mode de session ACP et les
instructions qui vont avec.

## Ce qui persiste où

| Élément                           | Emplacement                                                                                                    | Survit à un redémarrage ?    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| État Canvas (dont profils agents) | volume Docker `openhands-state`                                                                                | oui                          |
| Profils agents opencode           | `/home/openhands/.openhands/agent-profiles/` (vol.) + `~/.local/share/openhands/agent-profiles/` (hôte, copie) | oui                          |
| Binaire opencode                  | `~/.local/share/openhands/opencode/bin/`                                                                       | oui (monté)                  |
| Config opencode conteneur         | `~/.local/share/openhands/opencode-container.jsonc`                                                            | oui (recopiée à chaque `up`) |
| Règles globales + skills + agents | `opencode/` du dépôt (`AGENTS.md`, `skills/`, `agents/`)                                                       | oui (recopiés à chaque `up`) |
| Projets                           | `~/src/github.com/mlhamel`                                                                                     | oui (monté, ACL)             |

Pour forcer une réinstallation d'opencode : supprime
`~/.local/share/openhands/opencode` puis relance `openhands.sh up`.

## Limites connues

- Canvas n'a pas de sélecteur de mode ACP : les quatre profils opencode
  épinglent les modes. `up` sème chaque profil manquant et retire le
  preset générique `opencode-acp` ; un profil déjà présent n'est jamais
  écrasé (les réglages du volume gagnent, y compris ceux faits dans
  l'UI). Plus aucun réglage manuel dans l'interface.
- L'agent ACP n'a pas accès aux mécaniques hôte (plugins, Director,
  permissions) — seulement au provider Ollama + GLM. Les instructions,
  elles, sont recopiées dans le conteneur à chaque `up` (`AGENTS.md` +
  skills, dont `planning`, + `agents/`) : le comportement « plan
  d'abord » s'applique aussi côté canvas. C'est volontaire : les plugins
  ne sont pas installés dans le conteneur.
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
