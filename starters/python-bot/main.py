from typing import Any, Dict, List, Optional
from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

app = FastAPI(title="FeedMeBots Python Starter Bot")

class BotAction(BaseModel):
    action: str  # "fold", "check", "call", "raise"
    amount: Optional[int] = None

def decide(state: Dict[str, Any]) -> BotAction:
    """
    Your bot's only job:
    "Here is the game state, what is your move?"
    """
    legal_actions = state.get("legalActions", [])
    legal_names = [a.get("action") for a in legal_actions]
    to_call = state.get("toCall", 0)
    big_blind = state.get("bigBlind", 100)
    hole_cards = state.get("holeCards", [])
    min_raise = state.get("minRaiseTo")

    print(f"[Python Bot] Stage: {state.get('stage')}, Cards: {hole_cards}, To Call: {to_call}")

    # 1. If we can check for free, check
    if "check" in legal_names:
        return BotAction(action="check")

    # 2. Call small bets (up to 1 Big Blind)
    if "call" in legal_names and to_call <= big_blind:
        return BotAction(action="call")

    # 3. If we hold Ace or King, play aggressively
    has_high_card = any(card.startswith(("A", "K")) for card in hole_cards)
    if has_high_card:
        if "raise" in legal_names and min_raise is not None:
            return BotAction(action="raise", amount=min_raise)
        if "call" in legal_names:
            return BotAction(action="call")

    # 4. Otherwise fold
    return BotAction(action="fold")

@app.post("/", response_model=BotAction)
@app.post("/action", response_model=BotAction)
def handle_action(state: Dict[str, Any]):
    return decide(state)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=4002)
