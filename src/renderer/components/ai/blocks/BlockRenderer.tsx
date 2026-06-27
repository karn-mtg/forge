import type { ChatEvent } from '../../../../shared/chat-events';
import { CardShowcaseBlock } from './CardShowcaseBlock';
import { AskChoiceBlock, AskConfirmBlock, AskCardPickBlock } from './AskChoiceBlock';
import {
  SuggestSwapBlock,
  SuggestAddCardBlock,
  SuggestRemoveCardBlock,
  SuggestCreateDeckBlock,
  SuggestCreateGroupBlock,
} from './SuggestionBlocks';
import {
  ThinkingBlock,
  DeckDiffBlock,
  OpenDeckBlock,
  HighlightCardsBlock,
  SetSearchFiltersBlock,
  FocusArrangementBlock,
} from './MiscBlocks';

interface Props {
  event: ChatEvent;
  answered?: boolean;
}

export function BlockRenderer({ event, answered }: Props) {
  switch (event.type) {
    case 'card_showcase':
    case 'card_detail':
      return <CardShowcaseBlock event={event} />;

    case 'thinking':
      return <ThinkingBlock event={event} />;

    case 'deck_diff':
      return <DeckDiffBlock event={event} />;

    case 'ask_choice':
      return <AskChoiceBlock event={event} answered={answered} />;

    case 'ask_confirm':
      return <AskConfirmBlock event={event} answered={answered} />;

    case 'ask_card_pick':
      return <AskCardPickBlock event={event} answered={answered} />;

    case 'suggest_swap':
      return <SuggestSwapBlock event={event} />;

    case 'suggest_add_card':
      return <SuggestAddCardBlock event={event} />;

    case 'suggest_remove_card':
      return <SuggestRemoveCardBlock event={event} />;

    case 'suggest_create_deck':
      return <SuggestCreateDeckBlock event={event} />;

    case 'suggest_create_group':
      return <SuggestCreateGroupBlock event={event} />;

    case 'open_deck':
      return <OpenDeckBlock event={event} />;

    case 'highlight_cards':
      return <HighlightCardsBlock event={event} />;

    case 'set_search_filters':
      return <SetSearchFiltersBlock event={event} />;

    case 'focus_arrangement':
      return <FocusArrangementBlock event={event} />;

    // suggest_prints_change and deck_summary: render minimal info for now
    case 'suggest_prints_change':
      return (
        <div className="mb-2 text-xs px-1" style={{ color: '#888' }}>
          Print suggestion: {event.set_name ?? event.scryfall_id}
        </div>
      );

    case 'deck_summary':
      return (
        <div className="mb-2 text-xs px-1" style={{ color: '#888' }}>
          Deck #{event.deck_id}
        </div>
      );

    default:
      return null;
  }
}
