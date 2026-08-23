"""Clash Mode billing API — status, plans, Razorpay subscribe/cancel, webhooks."""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from backend.database.auth_middleware import get_current_user
from backend.services import clash_billing

router = APIRouter(tags=["Clash Billing"])


class SubscribeBody(BaseModel):
    plan_id: str = Field(..., description="basic | fearless")


class CreateOrderBody(BaseModel):
    plan_id: Optional[str] = Field(default=None, description="Clash plan: basic | fearless")
    amount: Optional[int] = Field(default=None, description="Amount in paise (min 100)")
    currency: str = "INR"
    receipt: Optional[str] = None


class VerifyPaymentBody(BaseModel):
    razorpay_order_id: str = ""
    razorpay_payment_id: str = ""
    razorpay_signature: str = ""
    razorpay_subscription_id: str = ""


def _billing_http(exc: Exception) -> HTTPException:
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, RuntimeError):
        return HTTPException(status_code=503, detail=str(exc))
    status = clash_billing.razorpay_error_http_status(exc)
    return HTTPException(status_code=status, detail=f"Razorpay error: {exc}")


@router.get("/api/clash/billing/plans")
async def clash_billing_plans(user=Depends(get_current_user)):
    del user
    return {"plans": clash_billing.list_plans()}


@router.get("/api/clash/billing/status")
async def clash_billing_status(user=Depends(get_current_user)):
    uid = str(user["id"])
    try:
        clash_billing.sync_pending_checkouts(uid)
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ clash billing status sync skipped: {exc}")
    return clash_billing.resolve_entitlement(uid)


@router.post("/api/clash/billing/sync")
async def clash_billing_sync(user=Depends(get_current_user)):
    """Confirm pending UPI/card checkouts against Razorpay (Checkout.js may never return)."""
    uid = str(user["id"])
    try:
        clash_billing.sync_pending_checkouts(uid)
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️ clash billing sync skipped: {exc}")
    return clash_billing.resolve_entitlement(uid)


@router.post("/api/clash/billing/subscribe")
async def clash_billing_subscribe(body: SubscribeBody, user=Depends(get_current_user)):
    plan_id = (body.plan_id or "").strip().lower()
    try:
        result = clash_billing.create_subscription_checkout(
            str(user["id"]),
            plan_id,
            email=(user.get("email") or None),
        )
        return result
    except Exception as exc:  # noqa: BLE001
        raise _billing_http(exc) from exc


@router.post("/api/create-order")
async def create_order(body: CreateOrderBody, user=Depends(get_current_user)):
    plan_id = (body.plan_id or "").strip().lower()
    try:
        if plan_id:
            checkout = clash_billing.create_subscription_checkout(
                str(user["id"]),
                plan_id,
                email=(user.get("email") or None),
            )
            return {
                "order_id": checkout.get("order_id") or checkout.get("subscription_id"),
                "amount": checkout.get("amount") or checkout.get("price_paise"),
                "currency": checkout.get("currency") or "INR",
                "key_id": checkout.get("key_id"),
                "checkout_mode": checkout.get("checkout_mode"),
                "plan_id": checkout.get("plan_id"),
            }
        if body.amount is None:
            raise ValueError("Provide plan_id or amount (paise)")
        return clash_billing.create_standard_order(
            amount=int(body.amount),
            currency=body.currency,
            receipt=body.receipt,
            user_id=str(user["id"]),
        )
    except Exception as exc:  # noqa: BLE001
        raise _billing_http(exc) from exc


@router.post("/api/clash/billing/verify")
async def clash_billing_verify(body: VerifyPaymentBody, user=Depends(get_current_user)):
    try:
        return clash_billing.verify_order_payment(
            str(user["id"]),
            razorpay_order_id=(body.razorpay_order_id or "").strip(),
            razorpay_payment_id=(body.razorpay_payment_id or "").strip(),
            razorpay_signature=(body.razorpay_signature or "").strip(),
            razorpay_subscription_id=(body.razorpay_subscription_id or "").strip(),
        )
    except Exception as exc:  # noqa: BLE001
        raise _billing_http(exc) from exc


@router.post("/api/verify-payment")
async def verify_payment(body: VerifyPaymentBody, user=Depends(get_current_user)):
    try:
        return clash_billing.confirm_standard_payment(
            str(user["id"]),
            razorpay_order_id=(body.razorpay_order_id or "").strip(),
            razorpay_payment_id=(body.razorpay_payment_id or "").strip(),
            razorpay_signature=(body.razorpay_signature or "").strip(),
            razorpay_subscription_id=(body.razorpay_subscription_id or "").strip(),
        )
    except Exception as exc:  # noqa: BLE001
        raise _billing_http(exc) from exc


@router.post("/api/clash/billing/cancel")
async def clash_billing_cancel(user=Depends(get_current_user)):
    try:
        return clash_billing.cancel_subscription(str(user["id"]))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Razorpay error: {exc}") from exc


@router.post("/api/clash/billing/webhook")
async def clash_billing_webhook(
    request: Request,
    x_razorpay_signature: Optional[str] = Header(default=None, alias="X-Razorpay-Signature"),
):
    body = await request.body()
    try:
        if not clash_billing.verify_webhook_signature(body, x_razorpay_signature or ""):
            raise HTTPException(status_code=400, detail="Invalid webhook signature")
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        event: dict[str, Any] = json.loads(body.decode("utf-8") or "{}")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc

    try:
        result = clash_billing.process_webhook_event(event)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
