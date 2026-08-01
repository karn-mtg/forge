import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import lib from './library.js';

let tmpDir;
let db;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karnforge-lib-test-'));
  db = lib.initLibrary(tmpDir);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeDeck() {
  const { id: deckId } = lib.createDeck(db, { name: 'Test Deck' });
  return deckId;
}

describe('branches & versions', () => {
  it('gives a new deck a protected root branch with zero versions', () => {
    const deckId = makeDeck();
    const branches = lib.getBranches(db, { deckId });
    expect(branches).toHaveLength(1);
    expect(branches[0].is_root).toBe(1);
    expect(branches[0].is_active).toBe(true);
    expect(branches[0].tip_version_number).toBe(0);
  });

  it('is dirty once cards exist but nothing has been released', () => {
    const deckId = makeDeck();
    expect(lib.isDeckDirty(db, { deckId })).toBe(false);
    lib.addCardToDeck(db, { deckId, oracleId: 'card-1' });
    expect(lib.isDeckDirty(db, { deckId })).toBe(true);
  });

  it('releasing a version clears the dirty flag and bumps the tip', () => {
    const deckId = makeDeck();
    lib.addCardToDeck(db, { deckId, oracleId: 'card-1', quantity: 2 });
    const rootBranch = lib.getBranches(db, { deckId })[0];

    const v1 = lib.releaseVersion(db, { branchId: rootBranch.id, message: 'first cut' });
    expect(v1.version_number).toBe(1);
    expect(lib.isDeckDirty(db, { deckId })).toBe(false);

    const branchesAfter = lib.getBranches(db, { deckId });
    expect(branchesAfter[0].tip_version_number).toBe(1);
    expect(branchesAfter[0].is_dirty).toBe(false);

    lib.addCardToDeck(db, { deckId, oracleId: 'card-2' });
    expect(lib.isDeckDirty(db, { deckId })).toBe(true);

    const v2 = lib.releaseVersion(db, { branchId: rootBranch.id });
    expect(v2.version_number).toBe(2);
  });

  it('creating a branch copies the exact snapshot of the source version', () => {
    const deckId = makeDeck();
    lib.addCardToDeck(db, { deckId, oracleId: 'card-1', quantity: 3, board: 'main' });
    const rootBranch = lib.getBranches(db, { deckId })[0];
    const v1 = lib.releaseVersion(db, { branchId: rootBranch.id, message: 'v1' });

    const { id: newBranchId } = lib.createBranch(db, { deckId, name: 'experiment', sourceVersionId: v1.id });
    const versions = lib.getVersions(db, { branchId: newBranchId });
    expect(versions).toHaveLength(1);
    expect(versions[0].card_count).toBe(3);

    const branches = lib.getBranches(db, { deckId });
    const newBranch = branches.find(b => b.id === newBranchId);
    expect(newBranch.is_root).toBe(0);
    expect(newBranch.parent_branch_id).toBe(rootBranch.id);
    expect(newBranch.parent_version_id).toBe(v1.id);
  });

  it('rejects creating a branch from a version belonging to a different deck', () => {
    const deckA = makeDeck();
    const deckB = makeDeck();
    lib.addCardToDeck(db, { deckId: deckA, oracleId: 'card-1' });
    const branchA = lib.getBranches(db, { deckId: deckA })[0];
    const vA = lib.releaseVersion(db, { branchId: branchA.id });

    expect(() => lib.createBranch(db, { deckId: deckB, name: 'x', sourceVersionId: vA.id })).toThrow();
  });

  it('blocks switching branches with unreleased changes unless onDirty is given', () => {
    const deckId = makeDeck();
    lib.addCardToDeck(db, { deckId, oracleId: 'card-1' });
    const rootBranch = lib.getBranches(db, { deckId })[0];
    const v1 = lib.releaseVersion(db, { branchId: rootBranch.id });
    const { id: branchId } = lib.createBranch(db, { deckId, name: 'feature', sourceVersionId: v1.id });

    // Dirty the active (root) branch's working state
    lib.addCardToDeck(db, { deckId, oracleId: 'card-2' });

    let thrown = null;
    try {
      lib.switchBranch(db, { deckId, targetBranchId: branchId });
    } catch (e) { thrown = e; }
    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('DECK_DIRTY');

    // 'discard' proceeds, dropping the uncommitted card-2 addition
    lib.switchBranch(db, { deckId, targetBranchId: branchId, onDirty: 'discard' });
    const deck = lib.getDeck(db, { id: deckId });
    expect(deck.active_branch_id).toBe(branchId);
    expect(deck.cards.map(c => c.oracle_id).sort()).toEqual(['card-1']);
  });

  it('release-then-switch preserves the uncommitted changes as a new version', () => {
    const deckId = makeDeck();
    lib.addCardToDeck(db, { deckId, oracleId: 'card-1' });
    const rootBranch = lib.getBranches(db, { deckId })[0];
    const v1 = lib.releaseVersion(db, { branchId: rootBranch.id });
    const { id: branchId } = lib.createBranch(db, { deckId, name: 'feature', sourceVersionId: v1.id });

    lib.addCardToDeck(db, { deckId, oracleId: 'card-2' });
    lib.switchBranch(db, { deckId, targetBranchId: branchId, onDirty: 'release', message: 'wip' });

    const rootVersions = lib.getVersions(db, { branchId: rootBranch.id });
    expect(rootVersions).toHaveLength(2);
    expect(rootVersions[0].card_count).toBe(2); // newest first
  });

  it('rejects deleting the root branch or the currently active branch', () => {
    const deckId = makeDeck();
    lib.addCardToDeck(db, { deckId, oracleId: 'card-1' });
    const rootBranch = lib.getBranches(db, { deckId })[0];
    const v1 = lib.releaseVersion(db, { branchId: rootBranch.id });
    const { id: branchId } = lib.createBranch(db, { deckId, name: 'feature', sourceVersionId: v1.id });

    // root is active right now — both guards would fire; root-guard still applies
    expect(() => lib.deleteBranch(db, { id: rootBranch.id })).toThrow();
    expect(lib.getBranches(db, { deckId })).toHaveLength(2);

    lib.switchBranch(db, { deckId, targetBranchId: branchId });
    // now root is not active, but still protected as root
    expect(() => lib.deleteBranch(db, { id: rootBranch.id })).toThrow();
    // branchId is now active — can't delete the currently checked-out branch
    expect(() => lib.deleteBranch(db, { id: branchId })).toThrow();
    expect(lib.getBranches(db, { deckId })).toHaveLength(2);
  });

  it('computes added/removed/changed correctly between two versions', () => {
    const deckId = makeDeck();
    lib.addCardToDeck(db, { deckId, oracleId: 'card-1', quantity: 1 });
    lib.addCardToDeck(db, { deckId, oracleId: 'card-2', quantity: 2 });
    const rootBranch = lib.getBranches(db, { deckId })[0];
    const v1 = lib.releaseVersion(db, { branchId: rootBranch.id });

    const cards = lib.getDeck(db, { id: deckId }).cards;
    const card1 = cards.find(c => c.oracle_id === 'card-1');
    lib.updateCardQuantity(db, { id: card1.id, quantity: 5 });
    const card2 = cards.find(c => c.oracle_id === 'card-2');
    lib.removeCardFromDeck(db, { id: card2.id });
    lib.addCardToDeck(db, { deckId, oracleId: 'card-3', quantity: 1 });
    const v2 = lib.releaseVersion(db, { branchId: rootBranch.id });

    const diff = lib.getVersionDiff(db, { versionAId: v1.id, versionBId: v2.id });
    expect(diff.added).toEqual([{ oracle_id: 'card-3', scryfall_id: null, quantity: 1, board: 'main', category: null, sort_order: 0, is_proxy: 0 }]);
    expect(diff.removed.map(c => c.oracle_id)).toEqual(['card-2']);
    expect(diff.changed).toEqual([{ oracle_id: 'card-1', board: 'main', from_quantity: 1, to_quantity: 5 }]);
  });

  it('restoreVersion materializes an older snapshot as the live working state', () => {
    const deckId = makeDeck();
    lib.addCardToDeck(db, { deckId, oracleId: 'card-1', quantity: 1 });
    const rootBranch = lib.getBranches(db, { deckId })[0];
    const v1 = lib.releaseVersion(db, { branchId: rootBranch.id });

    lib.addCardToDeck(db, { deckId, oracleId: 'card-2', quantity: 1 });
    lib.releaseVersion(db, { branchId: rootBranch.id });

    lib.restoreVersion(db, { versionId: v1.id });
    const deck = lib.getDeck(db, { id: deckId });
    expect(deck.cards.map(c => c.oracle_id)).toEqual(['card-1']);
  });
});
