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
3. **GitHub App** (optionnel) — si `~/.config/openhands/github-app.pem`
   et l'App ID (`~/.config/openhands/github-app.conf`, pas un secret)
   sont présents : la clé (mode 600 initial, read-only pour l'utilisateur
   du conteneur) est montée read-only, le helper `gh-app-token` est posé
   dans le dossier opencode persistant et branché comme credential
   helper git du conteneur — push et PR passent par des tokens courts,
   mintés à la demande, rien n'est persisté. Clé absente : `up` prévient
   et continue. Permissions trop larges ou App ID manquant : `up` échoue avec le
   correctif dans le message.
4. **Conteneur** — démarre `ghcr.io/openhands/agent-canvas:1.43.0` (détaché,
   nommé `openhands-canvas`), avec : projets montés, volume d'état
   `openhands-state` et dossier opencode persistant
   (`~/.local/share/openhands/opencode` → `/home/openhands/.opencode`, le
   binaire survit aux redémarrages). L'interface doit répondre avant
   l'installation de la config ; un arrêt prématuré affiche l'état,
   le code de sortie et les 30 dernières lignes des logs.
5. **Config install** — copie la config dans le conteneur (`mkdir -p` +
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
6. **Profils** — sème quatre profils d'agent opencode dans le conteneur
   (`opencode-build`, `opencode-ask`, `opencode-plan`, `opencode-review`),
   chacun épinglant son mode de session ACP : présents, ils sont
   conservés (les modifications faites dans l'UI survivent) ; absents,
   ils sont écrits depuis les définitions canoniques ; le preset
   générique `opencode-acp` est retiré.
7. **Binaire** — installe opencode dans le conteneur si absent (l'install
   atterrit dans le dossier persistant : coût unique).
8. **Santé** — attend que l'interface réponde, puis affiche un résumé.

## Usage

Depuis ce dépôt (ou après l'avoir copié dans `~/bin`, qui doit être dans
le PATH) :

```sh
openhands/openhands.sh            # up (défaut)
openhands/openhands.sh up         # idem — sûr à relancer, ne refait que ce qui manque
openhands/openhands.sh status     # conteneur + interface + binaire + config + règles + GitHub App
openhands/openhands.sh down       # stoppe + supprime le conteneur (état et fichiers conservés)
openhands/openhands.sh restart    # down + up
openhands/openhands.sh help
```

Puis ouvre <http://localhost:8000/canvas>.

## GitHub App (optionnel) — push et PR

Sans branchement, l'agent Canvas commite en local mais ne peut ni
pousser ni ouvrir de PR. Brancher une GitHub App lui donne les deux,
multi-dépôt, avec un secret minimal : la clé privée reste un fichier
hôte (mode 600) monté read-only, et le conteneur n'obtient que des
tokens d'installation courts (1 h), mintés à la demande et jamais
persistés (ni logs, ni dotfiles, ni git).

### Décision `gh`

`openhands.sh` n'installe pas `gh`. Le helper sert de credential helper
git (push/pull transparents) et, pour le reste, l'agent l'appelle en
mode `gh` : `gh-app-token gh pr create …` mint un token à chaque appel
et l'exporte comme `GH_TOKEN`. Si `gh` manque dans l'image, l'agent
l'installe dans le dossier persistant (comme opencode) ou retombe sur
l'API GitHub avec `curl` + `gh-app-token token`.

### Étapes humaines (une fois, dans l'interface GitHub)

1. **Créer l'app** — GitHub → Settings → Developer settings → GitHub
   Apps → New GitHub App ; nom libre (`openhands-agent`), webhook
   inactif (aucun événement utile).
2. **Permissions** — repository only, le minimum : `contents: write`
   (pousser des branches) et `pull_requests: write` (ouvrir des PR) ;
   `metadata: read` est implicite. Aucune autre permission de dépôt, ni
   permission organisation/utilisateur.
3. **Clé privée** — « Generate a private key » (PEM), à télécharger une
   seule fois.
4. **Installer l'app** — sur _selected repositories_ (jamais « all
   repositories ») : dotfiles d'abord, puis les dépôts à ouvrir.

### Layout hôte et branchement

- `~/.config/openhands/github-app.pem` — la clé, **mode 600**. Seul
  secret : jamais dans le dépôt ou l'image, jamais copiée hors du
  montage read-only (`/run/openhands-github-app.pem`). Ce chemin reste
  hors de `.config` pour ne pas créer ce dossier avec un propriétaire
  root et empêcher Canvas d'y écrire.
- `~/.config/openhands/github-app.conf` — pas une donnée sensible :
  `GITHUB_APP_ID=123456` (identifiant public de l'app).

Au prochain `up` : clé absente → `up` prévient et continue sans
brancher ; clé présente → montage read-only, helper `gh-app-token` posé
(755) dans le dossier opencode persistant et configuré comme credential
helper git du conteneur ; permissions trop larges ou App ID manquant → `up` échoue
avec le correctif dans le message. Le résumé de `up` et `status`
affichent l'état (branchée, App ID affiché / non branchée).

La clé doit appartenir à l'utilisateur hôte. `up` accepte le mode 600
initial et le mode 640 produit par sa propre ACL `user:10001:r--` :
le groupe propriétaire reste sans accès (`group::---`), les bits de
groupe affichés représentent le masque ACL. Toute autre ACL nommée,
tout accès au groupe propriétaire ou aux autres, ou tout droit
d'écriture/exécution pour uid 10001 est refusé. Il n'est pas nécessaire
de refaire `chmod 600` à chaque lancement.

Après une mise à jour depuis l'ancien montage dans `.config`, lance
`openhands/openhands.sh restart` une fois. Le conteneur est recréé,
mais le volume `openhands-state`, les profils et le binaire persistant
sont conservés. `up` refuse un conteneur dont le montage de clé est
incompatible plutôt que de continuer avec un mauvais branchement.
Si le conteneur est arrêté, `status` indique que les vérifications
internes sont indisponibles, sans déclarer les fichiers absents.

### Prérequis et garde-fous

- **Protection de branche** — règle sur `master` de chaque dépôt ouvert
  à l'app : PR obligatoire (une approbation, dismiss stale, revue du
  code owner via `.github/CODEOWNERS`), checks `prek`/`test` exigés et
  branche à jour, linear history, ni force push ni suppression,
  enforced for admins. Le script ne le vérifie pas : c'est ce qui borne
  l'agent à pousser des branches et ouvrir des PR relus par un humain.
  Commandes : « Mise en place complète » ci-dessous.
- **Rotation** — régénère la clé dans les réglages de l'app (l'ancienne
  meurt immédiatement), remplace le fichier hôte (mode 600), relance
  `openhands.sh restart`.
- **Révocation** — désinstalle l'app d'un dépôt pour le couper
  (immédiat) ; suspendre ou supprimer l'app coupe tout.
- **Risque résiduel (v1, assumé)** — un agent prompt-injecté peut lire
  la clé montée. Ce qui borne le dommage : permissions minimales,
  dépôts choisis un par un, tokens courts, clé régénérable en une
  minute.

### Mise en place complète (commandes)

Une fois les étapes humaines ci-dessus faites (app créée, clé
téléchargée) :

```bash
mkdir -p ~/.config/openhands
install -m 600 ~/Downloads/mlhamel-openhands-agent.<date>.private-key.pem \
  ~/.config/openhands/github-app.pem
echo 'GITHUB_APP_ID=<id-de-l-app>' > ~/.config/openhands/github-app.conf
openhands/openhands.sh up      # monte la clé read-only, pose le helper
openhands/openhands.sh status  # attendu : GitHub App branchée, App ID affiché
```

La protection de branche se pose avec un PAT personnel éphémère — pas
le token de l'app : l'app garde son minimum (contents + pull
requests), Administration est au-dessus de son périmètre.

```bash
read -rs GH_PAT && export GH_PAT
REPO=dotfiles                  # répéter pour chaque dépôt ouvert à l'app
curl -s -X PUT -H "Authorization: Bearer $GH_PAT" \
  "https://api.github.com/repos/mlhamel/$REPO/branches/master/protection" \
  -d '{"required_status_checks":{"strict":true,"contexts":["prek","test"]},"enforce_admins":true,"required_pull_request_reviews":{"required_approving_review_count":1,"require_code_owner_reviews":true,"dismiss_stale_reviews":true,"require_last_push_approval":false},"restrictions":null,"required_linear_history":true,"allow_force_pushes":false,"allow_deletions":false,"lock_branch":false}'
unset GH_PAT REPO
```

Les `contexts` sont les jobs CI du dépôt (`prek`, `test` pour
dotfiles ; `[]` pour un dépôt sans CI). Le CODEOWNERS
(`.github/CODEOWNERS`, une ligne : `* @mlhamel`) est versionné avec le
dépôt ; pour un nouveau dépôt ouvert à l'app, l'ajouter via une PR —
c'est lui qui fait remonter la revue du code owner dans la règle
ci-dessus.

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
- Le branchement GitHub App est optionnel et la protection de branche
  de `master` n'est pas vérifiée par le script (GitHub Settings →
  Branches, PR obligatoire) ; en v1 la clé privée reste lisible dans le
  conteneur (montée read-only) — voir « GitHub App (optionnel) ».
- Premier lancement sur une machine : c'est le vrai test (les parties
  Docker ne sont pas couvertes par le harnais shell, qui tourne avec un
  `docker` factice).
