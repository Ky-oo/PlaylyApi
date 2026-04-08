# API Groupes — Documentation Frontend

Toutes les routes `/group` nécessitent un token JWT dans le header :

```
Authorization: Bearer <token>
```

---

## Modèles de données

### Groupe

```json
{
  "id": 1,
  "name": "Les Boardgamers de Lyon",
  "description": "Groupe de joueurs lyonnais",
  "cover_img_url": "https://...",
  "is_public": true,
  "createdAt": "2026-04-08T10:00:00.000Z",
  "updatedAt": "2026-04-08T10:00:00.000Z",
  "members": [
    {
      "id": 6,
      "firstname": "Kylian",
      "lastname": "Dupont",
      "pseudo": "Kylian2",
      "GroupMember": {
        "role": "owner",
        "joined_at": "2026-04-08T10:00:00.000Z"
      }
    }
  ]
}
```

**Rôles possibles dans `GroupMember.role`** : `owner` | `admin` | `member`

---

### Message de groupe

```json
{
  "id": 12,
  "group_id": 1,
  "sender_id": 6,
  "content": "On se retrouve samedi ?",
  "type": "text",
  "is_deleted": false,
  "edited_at": null,
  "send_at": "2026-04-08T11:00:00.000Z",
  "createdAt": "2026-04-08T11:00:00.000Z",
  "sender": {
    "id": 6,
    "firstname": "Kylian",
    "lastname": "Dupont",
    "pseudo": "Kylian2"
  },
  "replyTo": null
}
```

---

## Routes

### Lister les groupes publics

```
GET /group
```

Retourne tous les groupes publics. Un admin voit aussi les groupes privés.

**Réponse 200**

```json
[
  { "id": 1, "name": "...", "is_public": true, "members": [...] }
]
```

---

### Mes groupes

```
GET /group/mine
```

Retourne uniquement les groupes dont l'utilisateur connecté est membre (quel que soit son rôle).

**Réponse 200** — même structure que `GET /group`

---

### Détail d'un groupe

```
GET /group/:id
```

- Si `is_public: false` : accessible uniquement aux membres du groupe et aux admins.

**Réponse 200** — objet groupe avec `members`
**Réponse 403** — groupe privé, non membre

---

### Créer un groupe

```
POST /group
```

**Body**

```json
{
  "name": "Les Boardgamers de Lyon",
  "description": "Groupe de joueurs lyonnais",
  "cover_img_url": "https://...",
  "is_public": true
}
```

- `name` : obligatoire
- `description`, `cover_img_url` : optionnels
- `is_public` : optionnel, `true` par défaut

L'utilisateur qui crée le groupe devient automatiquement **owner**.

**Réponse 201** — objet groupe créé

---

### Modifier un groupe

```
PUT /group/:id
```

Accessible : owner du groupe, admin du groupe, admin du site.

**Body** (tous les champs sont optionnels)

```json
{
  "name": "Nouveau nom",
  "description": "...",
  "cover_img_url": "https://...",
  "is_public": false
}
```

**Réponse 200** — objet groupe mis à jour
**Réponse 403** — pas les droits

---

### Supprimer un groupe

```
DELETE /group/:id
```

Accessible : **admin du site uniquement**.

**Réponse 204** — pas de contenu

---

### Rejoindre un groupe

```
POST /group/:id/join
```

Permet à l'utilisateur connecté de rejoindre un groupe **public**. Les groupes privés nécessitent une invitation.

**Réponse 201**

```json
{ "message": "Joined group" }
```

**Réponse 403** — groupe privé
**Réponse 409** — déjà membre

---

### Inviter un utilisateur (groupe privé ou non)

```
POST /group/:id/invite
```

Accessible : owner du groupe, admin du groupe, admin du site.

**Body**

```json
{ "userId": 42 }
```

**Réponse 201**

```json
{ "message": "User added to group" }
```

**Réponse 403** — pas les droits
**Réponse 404** — utilisateur introuvable
**Réponse 409** — déjà membre

---

### Quitter un groupe

```
DELETE /group/:id/leave
```

L'utilisateur connecté quitte le groupe.

> ⚠️ Si l'utilisateur est **owner** et qu'il est le seul owner/admin, il ne peut pas quitter tant qu'il reste d'autres membres. Il faut soit transférer les droits (via invite + suppression), soit retirer tous les membres d'abord.

**Réponse 204** — pas de contenu
**Réponse 400** — owner sans autre admin

---

### Retirer un membre

```
DELETE /group/:id/members/:userId
```

Accessible : owner du groupe, admin du groupe, admin du site.

> ⚠️ L'owner d'un groupe ne peut être retiré que par un admin du site.

**Réponse 204** — pas de contenu
**Réponse 403** — pas les droits
**Réponse 404** — membre introuvable

---

## Activités de groupe

### Lister les activités d'un groupe

```
GET /group/:id/activities
```

Accessible : membres du groupe uniquement.

Les activités de groupe ne sont **pas visibles** dans `GET /activity` pour les utilisateurs non membres.

**Réponse 200**

```json
[
  {
    "id": 68,
    "title": "Soirée Catan",
    "description": "...",
    "date": "2026-05-10T18:00:00.000Z",
    "address": "...",
    "city": "Lyon",
    "postalCode": "69001",
    "latitude": "45.748",
    "longitude": "4.847",
    "place_name": "Chez Marc",
    "seats": 6,
    "type": "Par des joueurs",
    "price": "0.00",
    "private": false,
    "groupId": 1,
    "hostUserId": 24,
    "hostOrganisationId": null,
    "createdAt": "2026-04-08T09:00:00.000Z"
  }
]
```

### Créer une activité pour un groupe

```
POST /activity
```

Pour créer une activité liée à un groupe, ajouter le champ `groupId` dans le body de création d'activité standard.

**Body (extrait)**

```json
{
  "title": "Soirée Catan",
  "groupId": 1,
  "hostUserId": 24,
  ...
}
```

---

## Chat interne du groupe

### Récupérer les messages

```
GET /group/:id/messages
```

Accessible : membres du groupe uniquement.

**Query params**
| Param | Type | Défaut | Description |
|---|---|---|---|
| `limit` | number | 50 | Nombre de messages (max 200) |
| `before` | number | — | ID de message — charge les messages antérieurs (pagination) |

**Réponse 200**

```json
{
  "data": [
    {
      "id": 12,
      "content": "On se retrouve samedi ?",
      "send_at": "2026-04-08T11:00:00.000Z",
      "sender": {
        "id": 6,
        "firstname": "Kylian",
        "lastname": "Dupont",
        "pseudo": "Kylian2"
      },
      "replyTo": null
    }
  ]
}
```

---

### Envoyer un message

```
POST /group/:id/messages
```

Accessible : membres du groupe uniquement.

**Body**

```json
{
  "content": "On se retrouve samedi ?",
  "reply_to_id": 11
}
```

- `content` : obligatoire
- `reply_to_id` : optionnel — ID d'un message du même groupe pour répondre

**Réponse 201** — objet message créé (avec `sender` et `replyTo` inclus)

---

### Supprimer un message (soft-delete)

```
DELETE /group/:id/messages/:messageId
```

Accessible : auteur du message, owner/admin du groupe, admin du site.

Le message n'est pas physiquement supprimé : `is_deleted` passe à `true` et `content` est vidé. À afficher côté frontend comme _"Message supprimé"_.

**Réponse 204** — pas de contenu

---

## Règles de visibilité résumées

| Situation                      | Peut voir                                                           |
| ------------------------------ | ------------------------------------------------------------------- |
| Visiteur non connecté          | Activités publiques sans `groupId` uniquement                       |
| Connecté, non membre du groupe | Activités publiques sans `groupId` uniquement                       |
| Membre du groupe               | Activités publiques + activités du groupe                           |
| **Activité `homeHost: true`**  | Adresse et liste des participants masqués pour les non-participants |
