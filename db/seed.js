'use strict';

const { createFolder, createDeck } = require('./library');

function seedLibrary(db) {
  const existing = db.prepare('SELECT COUNT(*) as count FROM folders').get();
  if (existing.count > 0) return;

  const { id: commanderFolderId } = createFolder(db, {
    name: 'Commander',
    icon: 'crown',
  });

  const { id: modernFolderId } = createFolder(db, {
    name: 'Modern',
    icon: 'zap',
  });

  createDeck(db, {
    name: 'Shadow of Void',
    format: 'commander',
    folderId: commanderFolderId,
    colorIdentity: 'UB',
  });
  db.prepare(`
    UPDATE decks SET
      description = 'A control deck built around enter-the-battlefield flicker combos and blue-black finishers.',
      power_level = 7,
      is_favorite = 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    WHERE name = 'Shadow of Void' AND folder_id = ?
  `).run(commanderFolderId);

  createDeck(db, {
    name: 'Sylvan Resonance',
    format: 'modern',
    folderId: modernFolderId,
    colorIdentity: 'GW',
  });
  db.prepare(`
    UPDATE decks SET
      description = 'An aggressive creature-based deck leveraging green ramp and white removal.',
      power_level = 6,
      is_favorite = 0,
      updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    WHERE name = 'Sylvan Resonance' AND folder_id = ?
  `).run(modernFolderId);

  createDeck(db, {
    name: 'Aetheric Surge',
    format: 'modern',
    folderId: modernFolderId,
    colorIdentity: 'UR',
  });
  db.prepare(`
    UPDATE decks SET
      description = 'A tempo-oriented storm deck using blue cantrips and red burn to close games fast.',
      power_level = 8,
      is_favorite = 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    WHERE name = 'Aetheric Surge' AND folder_id = ?
  `).run(modernFolderId);
}

module.exports = { seedLibrary };
