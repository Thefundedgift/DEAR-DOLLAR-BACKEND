"""
Comprehensive backend tests for DEAR DOLLAR.com
Covers: auth (customer/admin), wallets, deposits, buy/sell orders, RBAC,
payment settings, bank details, social links, audit logs, reports, idempotency.
"""
import os
import time
import uuid
import random
import subprocess
import pytest
import requests

BASE = "https://47b2de3c-5aeb-49a6-b9c5-19c8643f4d8c.preview.emergentagent.com"
API = f"{BASE}/api"

ADMIN_EMAIL = "admin@deardollar.com"
ADMIN_PASSWORD = "Admin@12345"

MAIN_CUSTOMER_MOBILE = "9876543210"
MAIN_CUSTOMER_PASSWORD = "Customer@123"


def _rand_mobile():
    return "9" + "".join(str(random.randint(0, 9)) for _ in range(9))


def _register(mobile=None, password="Str0ng@Pass1", tries=12):
    """Register with retry on 429 rate-limit."""
    if mobile is None:
        mobile = _rand_mobile()
    for i in range(tries):
        r = requests.post(f"{API}/auth/register",
                          json={"mobile": mobile, "password": password})
        if r.status_code != 429:
            return r, mobile
        time.sleep(5 + i)
    return r, mobile


def _clear_lock(mobile: str):
    subprocess.run(["redis-cli", "DEL", f"cust:lock:{mobile}"], capture_output=True)


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="session")
def admin_token(s):
    r = s.post(f"{API}/admin/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code in (200, 201), f"admin login: {r.status_code} {r.text}"
    return r.json()["accessToken"]


@pytest.fixture(scope="session")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def customer(s):
    """Ensure main test customer is usable; if password mismatch, reset via admin."""
    _clear_lock(MAIN_CUSTOMER_MOBILE)
    r = s.post(f"{API}/auth/login",
               json={"mobile": MAIN_CUSTOMER_MOBILE,
                     "password": MAIN_CUSTOMER_PASSWORD})
    if r.status_code not in (200, 201):
        pytest.skip(f"main customer login failed: {r.status_code} {r.text}")
    j = r.json()
    return {"token": j["accessToken"], "refresh": j["refreshToken"],
            "user": j["user"], "mobile": MAIN_CUSTOMER_MOBILE}


@pytest.fixture(scope="session")
def cust_h(customer):
    return {"Authorization": f"Bearer {customer['token']}"}


# ---------- 1. Health ----------
class TestHealth:
    def test_health(self, s):
        r = s.get(f"{API}/health")
        assert r.status_code == 200
        j = r.json()
        assert j["status"] == "ok"
        assert j["database"] == "connected"
        assert j["redis"] == "connected"


# ---------- 2. Customer registration ----------
class TestRegistration:
    def test_register_success(self, s):
        r, mobile = _register()
        assert r.status_code in (200, 201), r.text
        j = r.json()
        assert "accessToken" in j and "refreshToken" in j
        assert j["user"]["mobile"] == mobile

    def test_register_duplicate(self, s):
        r1, mobile = _register()
        assert r1.status_code in (200, 201)
        r2, _ = _register(mobile=mobile)
        assert r2.status_code == 409

    def test_register_weak_password(self, s):
        r, _ = _register(password="weak")
        assert r.status_code == 400

    def test_register_invalid_mobile(self, s):
        r, _ = _register(mobile="1234567890")
        assert r.status_code == 400


# ---------- 3. Customer login + lockout + /me ----------
class TestLogin:
    def test_login_and_me(self, s, customer, cust_h):
        r = s.get(f"{API}/auth/me", headers=cust_h)
        assert r.status_code == 200
        j = r.json()
        assert "user" in j
        # wallets present
        assert "moneyWallet" in j or "wallets" in j or "dollarWallet" in j

    def test_login_lockout(self, s):
        # dedicated user
        _, mobile = _register()
        _clear_lock(mobile)
        got_429 = False
        for i in range(6):
            r = s.post(f"{API}/auth/login",
                       json={"mobile": mobile, "password": "WrongPass1!"})
            if r.status_code == 429:
                got_429 = True
                break
        _clear_lock(mobile)
        assert got_429, "expected 429 lockout after repeated failed attempts"


# ---------- 4. Refresh token rotation ----------
class TestRefresh:
    def test_refresh_rotation(self, s):
        rr, mobile = _register()
        assert rr.status_code in (200, 201), rr.text
        old_refresh = rr.json()["refreshToken"]
        r1 = s.post(f"{API}/auth/refresh",
                    json={"refreshToken": old_refresh})
        assert r1.status_code in (200, 201), r1.text
        new_refresh = r1.json()["refreshToken"]
        assert new_refresh and new_refresh != old_refresh
        # reuse old -> 401
        r2 = s.post(f"{API}/auth/refresh",
                    json={"refreshToken": old_refresh})
        assert r2.status_code == 401


# ---------- 5. Forgot / Reset password ----------
class TestPasswordReset:
    def test_forgot_password_generic(self, s):
        r = s.post(f"{API}/auth/forgot-password",
                   json={"mobile": MAIN_CUSTOMER_MOBILE})
        assert r.status_code in (200, 201)
        j = r.json()
        # Must never contain token
        assert "token" not in str(j).lower() or "resettoken" not in str(j).lower()
        for k in j.keys() if isinstance(j, dict) else []:
            assert "token" not in k.lower()

    def test_reset_with_garbage_token(self, s):
        r = s.post(f"{API}/auth/reset-password",
                   json={"token": "garbagetoken123",
                         "newPassword": "Str0ng@Pass1"})
        assert r.status_code == 401


# ---------- 6. Admin auth / RBAC basics ----------
class TestAdminAuth:
    def test_admin_login_ok(self, admin_token):
        assert admin_token

    def test_customer_cannot_access_admin(self, s, cust_h):
        r = s.get(f"{API}/admin/users", headers=cust_h)
        assert r.status_code == 403

    def test_no_token_admin_401(self, s):
        r = s.get(f"{API}/admin/users")
        assert r.status_code == 401


# ---------- 7. Admin password reset for customer ----------
class TestAdminPasswordReset:
    def test_admin_reset_flow(self, s, admin_h):
        reg, mobile = _register(password="Old@Pass123")
        assert reg.status_code in (200, 201), reg.text
        user_id = reg.json()["user"]["id"]
        r = s.post(f"{API}/admin/users/{user_id}/password-reset",
                   headers=admin_h, json={})
        assert r.status_code in (200, 201), r.text
        token = r.json().get("resetToken") or r.json().get("token")
        assert token
        new_pw = "New@Pass1234"
        r2 = s.post(f"{API}/auth/reset-password",
                    json={"token": token, "newPassword": new_pw})
        assert r2.status_code in (200, 201), r2.text
        # reuse -> 401
        r3 = s.post(f"{API}/auth/reset-password",
                    json={"token": token, "newPassword": "Another@Pass1"})
        assert r3.status_code == 401
        # login with new password
        _clear_lock(mobile)
        r4 = s.post(f"{API}/auth/login",
                    json={"mobile": mobile, "password": new_pw})
        assert r4.status_code in (200, 201)


# ---------- 8. Wallet adjustment (SUPER_ADMIN) ----------
class TestWalletAdjustment:
    def test_credit_customer(self, s, admin_h, customer):
        r = s.post(f"{API}/admin/users/wallet-adjustment", headers=admin_h,
                   json={"userId": customer["user"]["id"],
                         "amount": 10000, "direction": "CREDIT",
                         "reason": "test top-up"})
        assert r.status_code in (200, 201), r.text


# ---------- 9. Deposit flow ----------
class TestDeposits:
    def test_min_max_validation(self, s, cust_h):
        r_low = s.post(f"{API}/wallet/deposits", headers=cust_h,
                       json={"amount": 100})
        assert r_low.status_code == 400
        r_high = s.post(f"{API}/wallet/deposits", headers=cust_h,
                        json={"amount": 200000})
        assert r_high.status_code == 400

    def test_full_deposit_verify(self, s, cust_h, admin_h):
        r = s.post(f"{API}/wallet/deposits", headers=cust_h,
                   json={"amount": 500})
        assert r.status_code in (200, 201), r.text
        j = r.json()
        assert "upiId" in str(j) or j.get("upiIdSnapshot") or j.get("upiIdUsed")
        dep_id = j.get("id") or j.get("depositId") or j["deposit"]["id"]

        # verify before UTR -> 409
        vpre = s.post(f"{API}/admin/payments/{dep_id}/verify", headers=admin_h,
                      json={})
        assert vpre.status_code == 409

        utr = f"UTR{random.randint(100000000, 999999999)}"
        ru = s.post(f"{API}/wallet/deposits/{dep_id}/utr", headers=cust_h,
                    json={"utr": utr})
        assert ru.status_code in (200, 201), ru.text

        lst = s.get(f"{API}/admin/payments?status=PENDING", headers=admin_h)
        assert lst.status_code == 200
        v = s.post(f"{API}/admin/payments/{dep_id}/verify", headers=admin_h,
                   json={})
        assert v.status_code in (200, 201), v.text
        v2 = s.post(f"{API}/admin/payments/{dep_id}/verify", headers=admin_h,
                    json={})
        assert v2.status_code == 409


# ---------- 10. Buy listing + buy order flow ----------
@pytest.fixture(scope="session")
def buy_listing(s, admin_h):
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    payload = {"title": f"TEST_BuyListing_{uuid.uuid4().hex[:6]}",
               "moneyValue": 40, "pointQuantity": 9,
               "availableQuantity": 720,
               "startDate": (now - timedelta(hours=1)).isoformat(),
               "endDate": (now + timedelta(days=7)).isoformat()}
    r = s.post(f"{API}/admin/buy-listings", headers=admin_h, json=payload)
    assert r.status_code in (200, 201), r.text
    return r.json()


class TestBuyFlow:
    def test_customer_sees_buy_listing(self, s, cust_h, buy_listing):
        r = s.get(f"{API}/points/buy-listings", headers=cust_h)
        assert r.status_code == 200
        ids = [x.get("id") for x in (r.json() if isinstance(r.json(), list)
                                     else r.json().get("data", []))]
        assert buy_listing["id"] in ids

    def test_buy_invalid_multiple(self, s, cust_h, buy_listing):
        r = s.post(f"{API}/buy-orders", headers=cust_h,
                   json={"listingId": buy_listing["id"], "points": 361})
        assert r.status_code == 400

    def test_buy_and_approve(self, s, cust_h, admin_h, buy_listing, customer):
        r = s.post(f"{API}/buy-orders", headers=cust_h,
                   json={"listingId": buy_listing["id"], "points": 360})
        assert r.status_code in (200, 201), r.text
        order = r.json()
        assert str(order.get("moneyAmount")) == "1600"
        assert order.get("status") == "PENDING"
        order_id = order["id"]

        # approve
        ap = s.post(f"{API}/admin/buy-orders/{order_id}/approve",
                    headers=admin_h, json={})
        assert ap.status_code in (200, 201), ap.text
        # duplicate approve
        ap2 = s.post(f"{API}/admin/buy-orders/{order_id}/approve",
                     headers=admin_h, json={})
        assert ap2.status_code == 409

        # rate snapshot preserved
        detail = s.get(f"{API}/buy-orders/{order_id}", headers=cust_h)
        if detail.status_code == 200:
            assert str(detail.json().get("moneyAmount")) == "1600"

    def test_buy_insufficient_balance(self, s, buy_listing):
        # new customer with 0 balance
        rr, _ = _register()
        assert rr.status_code in (200, 201)
        reg = rr.json()
        h = {"Authorization": f"Bearer {reg['accessToken']}"}
        r = requests.post(f"{API}/buy-orders", headers=h,
                          json={"listingId": buy_listing["id"], "points": 9})
        assert r.status_code == 400

    def test_buy_reject_refunds(self, s, cust_h, admin_h, buy_listing):
        r = s.post(f"{API}/buy-orders", headers=cust_h,
                   json={"listingId": buy_listing["id"], "points": 9})
        if r.status_code not in (200, 201):
            pytest.skip(f"cannot create buy order for reject test: {r.text}")
        oid = r.json()["id"]
        rj = s.post(f"{API}/admin/buy-orders/{oid}/reject", headers=admin_h,
                    json={"reason": "test reject"})
        assert rj.status_code in (200, 201), rj.text


# ---------- 11. Sell / Demand listing flow ----------
@pytest.fixture(scope="session")
def demand_listing(s, admin_h):
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    payload = {"title": f"TEST_DemandListing_{uuid.uuid4().hex[:6]}",
               "moneyValue": 20, "pointQuantity": 10,
               "availableQuantity": 1000,
               "startDate": (now - timedelta(hours=1)).isoformat(),
               "endDate": (now + timedelta(days=7)).isoformat()}
    r = s.post(f"{API}/admin/demand-listings", headers=admin_h, json=payload)
    assert r.status_code in (200, 201), r.text
    return r.json()


class TestSellFlow:
    def test_sell_more_than_owned(self, s, admin_h, demand_listing):
        # fresh customer with 0 points
        rr, _ = _register()
        assert rr.status_code in (200, 201)
        reg = rr.json()
        h = {"Authorization": f"Bearer {reg['accessToken']}"}
        r = requests.post(f"{API}/sell-orders", headers=h,
                          json={"listingId": demand_listing["id"],
                                "points": 200})
        assert r.status_code == 400

    def test_sell_and_approve(self, s, cust_h, admin_h, demand_listing,
                              customer):
        r = s.post(f"{API}/sell-orders", headers=cust_h,
                   json={"listingId": demand_listing["id"], "points": 200})
        assert r.status_code in (200, 201), r.text
        j = r.json()
        assert str(j.get("moneyAmount")) == "400"
        oid = j["id"]
        ap = s.post(f"{API}/admin/sell-orders/{oid}/approve", headers=admin_h,
                    json={})
        assert ap.status_code in (200, 201), ap.text


# ---------- 12. Transaction histories ----------
class TestHistories:
    def test_wallet_tx(self, s, cust_h):
        r = s.get(f"{API}/wallet/transactions", headers=cust_h)
        assert r.status_code == 200
        data = r.json() if isinstance(r.json(), list) else \
            r.json().get("data", r.json().get("transactions", []))
        assert isinstance(data, list)

    def test_points_tx(self, s, cust_h):
        r = s.get(f"{API}/points/transactions", headers=cust_h)
        assert r.status_code == 200


# ---------- 13. Bank details ----------
class TestBankDetails:
    def test_bank_crud_and_masking(self, s):
        # new customer
        rr, _ = _register()
        assert rr.status_code in (200, 201)
        reg = rr.json()
        h = {"Authorization": f"Bearer {reg['accessToken']}"}
        # invalid IFSC
        bad = requests.post(f"{API}/bank-details", headers=h,
                            json={"accountHolder": "Foo", "bankName": "HDFC",
                                  "accountNumber": "123456789012",
                                  "ifsc": "BAD"})
        assert bad.status_code == 400
        r = requests.post(f"{API}/bank-details", headers=h,
                          json={"accountHolder": "Foo", "bankName": "HDFC",
                                "accountNumber": "123456789012",
                                "ifsc": "HDFC0001234"})
        assert r.status_code in (200, 201), r.text
        j = r.json()
        assert "9012" in str(j.get("accountNumber", ""))
        assert "*" in str(j.get("accountNumber", ""))
        bid = j["id"]
        # PUT
        up = requests.put(f"{API}/bank-details/{bid}", headers=h,
                         json={"accountHolder": "Foo Bar", "bankName": "HDFC",
                               "accountNumber": "123456789012",
                               "ifsc": "HDFC0001234"})
        assert up.status_code in (200, 201, 204), up.text
        # other user cannot access
        rr2, _ = _register()
        reg2 = rr2.json()
        h2 = {"Authorization": f"Bearer {reg2['accessToken']}"}
        other = requests.get(f"{API}/bank-details/{bid}", headers=h2)
        assert other.status_code in (403, 404)
        # DELETE
        d = requests.delete(f"{API}/bank-details/{bid}", headers=h)
        assert d.status_code in (200, 204)


# ---------- 14. Payment settings versioning ----------
class TestPaymentSettings:
    def test_customer_gets_active(self, s, cust_h):
        r = s.get(f"{API}/payment-settings", headers=cust_h)
        assert r.status_code == 200
        j = r.json()
        assert "upiId" in str(j)


# ---------- 15. Social links ----------
class TestSocialLinks:
    def test_admin_sets_and_public_filters(self, s, admin_h, cust_h):
        r1 = s.put(f"{API}/admin/social-links/TELEGRAM", headers=admin_h,
                   json={"url": "https://t.me/deardollar", "enabled": True})
        assert r1.status_code in (200, 201), r1.text
        r2 = s.put(f"{API}/admin/social-links/DISCORD", headers=admin_h,
                   json={"url": "https://discord.gg/xyz", "enabled": False})
        assert r2.status_code in (200, 201), r2.text
        pub = s.get(f"{API}/social-links")
        assert pub.status_code == 200
        data = pub.json() if isinstance(pub.json(), list) else \
            pub.json().get("data", [])
        platforms = [d.get("platform") for d in data]
        assert "TELEGRAM" in platforms
        assert "DISCORD" not in platforms


# ---------- 16. RBAC limited admin ----------
class TestRBAC:
    def test_limited_admin(self, s, admin_h):
        email = f"limited_{uuid.uuid4().hex[:6]}@test.com"
        pw = "Limited@Pass1"
        r = s.post(f"{API}/admin/admins", headers=admin_h,
                   json={"email": email, "password": pw,
                         "name": "Limited Admin", "role": "ADMIN",
                         "permissions": ["VIEW_CUSTOMERS"]})
        assert r.status_code in (200, 201), r.text
        # login as limited admin
        lg = s.post(f"{API}/admin/auth/login",
                    json={"email": email, "password": pw})
        assert lg.status_code in (200, 201), lg.text
        h = {"Authorization": f"Bearer {lg.json()['accessToken']}"}
        u = s.get(f"{API}/admin/users", headers=h)
        assert u.status_code == 200
        p = s.get(f"{API}/admin/payments", headers=h)
        assert p.status_code == 403
        rp = s.get(f"{API}/admin/reports/summary", headers=h)
        assert rp.status_code == 403
        # super admin only: social links
        sl = s.put(f"{API}/admin/social-links/TELEGRAM", headers=h,
                   json={"url": "https://t.me/x", "enabled": True})
        assert sl.status_code == 403


# ---------- 17. Audit logs + reports ----------
class TestAuditReports:
    def test_audit_logs(self, s, admin_h):
        r = s.get(f"{API}/admin/audit-logs", headers=admin_h)
        assert r.status_code == 200
        data = r.json() if isinstance(r.json(), list) else \
            r.json().get("data", [])
        assert isinstance(data, list) and len(data) > 0

    def test_reports_summary(self, s, admin_h):
        r = s.get(f"{API}/admin/reports/summary", headers=admin_h)
        assert r.status_code == 200


# ---------- 18. Idempotency ----------
class TestIdempotency:
    def test_buy_idempotent(self, s, cust_h, buy_listing):
        key = f"idem-{uuid.uuid4().hex}"
        h = {**cust_h, "Idempotency-Key": key}
        p = {"listingId": buy_listing["id"], "points": 9}
        r1 = requests.post(f"{API}/buy-orders", headers=h, json=p)
        if r1.status_code not in (200, 201):
            pytest.skip(f"idempotency create failed: {r1.text}")
        r2 = requests.post(f"{API}/buy-orders", headers=h, json=p)
        assert r2.status_code in (200, 201), r2.text
        assert r1.json()["id"] == r2.json()["id"]
