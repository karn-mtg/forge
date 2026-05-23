# Architecture: Domain-Driven Design (DDD)

## Layer structure

```
src/
├── domain/          ← Entities, Value Objects, IRepository interfaces
├── application/     ← Use Cases, DTOs
├── infrastructure/  ← Repository implementations (DB, external APIs)
├── main/            ← Electron main process + IPC handlers
└── renderer/        ← React UI (views, components, hooks)
```

## Core rule: use cases run in the main process

```
Renderer (React)  →  IPC  →  Main process  →  Use Case  →  Repository
```

- Renderer never imports domain/application directly
- All business logic and data access lives in the main process
- Renderer communicates exclusively via named IPC channels

## IPC wiring pattern

```ts
// main/ipc/deckHandlers.ts
ipcMain.handle('deck:create', (_, dto) => new CreateDeck(deckRepo).execute(dto))

// renderer/hooks/useDeck.ts
window.electron.ipcRenderer.invoke('deck:create', { name })
```

## Layer responsibilities

| Layer          | Contains                                      | Depends on   |
|----------------|-----------------------------------------------|--------------|
| domain         | Entity, ValueObject, IRepository (interface)  | nothing      |
| application    | UseCase, DTO                                  | domain       |
| infrastructure | Repository impl (SQLite, Scryfall API, etc.)  | domain       |
| main/ipc       | IPC handlers, DI wiring                       | application  |
| renderer       | React views, components, hooks                | IPC only     |

## Exception

Pure computation with no I/O (e.g. mana curve validation, local filtering) can
be placed in domain and imported by both main and renderer.
