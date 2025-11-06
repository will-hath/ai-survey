from openai.types.responses.response_create_params import ResponseCreateParamsNonStreaming

PROMPT_ID = "pmpt_690ba19536b88197a1c48fb6c5d8d6380b17d1daec64b5f4"

def make_response_request(input: str, conversation_id: str) -> ResponseCreateParamsNonStreaming:
    return ResponseCreateParamsNonStreaming(
        prompt={
            "id": PROMPT_ID,
        },
        input=input,
        conversation=conversation_id
    )
