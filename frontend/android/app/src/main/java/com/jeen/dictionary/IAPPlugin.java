package com.jeen.dictionary;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Collections;
import java.util.List;

@CapacitorPlugin(name = "IAP")
public class IAPPlugin extends Plugin implements PurchasesUpdatedListener {

    private BillingClient billingClient;
    private PluginCall pendingPurchaseCall;

    @Override
    public void load() {
        billingClient = BillingClient.newBuilder(getContext())
                .setListener(this)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .build();
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        String productId = call.getString("productId");
        if (productId == null) {
            call.reject("productId required");
            return;
        }
        call.setKeepAlive(true);
        pendingPurchaseCall = call;

        ensureConnected(new ConnectionCallback() {
            @Override
            public void onReady() {
                queryAndLaunch(productId);
            }

            @Override
            public void onError(String message) {
                settlePurchaseCall(null, message);
            }
        });
    }

    private void queryAndLaunch(String productId) {
        QueryProductDetailsParams.Product product = QueryProductDetailsParams.Product.newBuilder()
                .setProductId(productId)
                .setProductType(BillingClient.ProductType.SUBS)
                .build();
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(product))
                .build();
        billingClient.queryProductDetailsAsync(params, (billingResult, queryProductDetailsResult) -> {
            List<ProductDetails> productDetailsList = queryProductDetailsResult.getProductDetailsList();
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK || productDetailsList.isEmpty()) {
                settlePurchaseCall(null, "Product not found: " + productId);
                return;
            }
            ProductDetails details = productDetailsList.get(0);
            List<ProductDetails.SubscriptionOfferDetails> offers = details.getSubscriptionOfferDetails();
            if (offers == null || offers.isEmpty()) {
                settlePurchaseCall(null, "No offer available for: " + productId);
                return;
            }
            BillingFlowParams.ProductDetailsParams productDetailsParams = BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(details)
                    .setOfferToken(offers.get(0).getOfferToken())
                    .build();
            BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(Collections.singletonList(productDetailsParams))
                    .build();
            getActivity().runOnUiThread(() -> {
                BillingResult launchResult = billingClient.launchBillingFlow(getActivity(), flowParams);
                if (launchResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    settlePurchaseCall(null, launchResult.getDebugMessage());
                }
            });
        });
    }

    @Override
    public void onPurchasesUpdated(BillingResult billingResult, List<Purchase> purchases) {
        int code = billingResult.getResponseCode();
        if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            settlePurchaseCall(null, "cancelled");
            return;
        }
        if (code != BillingClient.BillingResponseCode.OK || purchases == null || purchases.isEmpty()) {
            settlePurchaseCall(null, billingResult.getDebugMessage());
            return;
        }
        Purchase purchase = purchases.get(0);
        if (!purchase.isAcknowledged()) {
            AcknowledgePurchaseParams ackParams = AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(purchase.getPurchaseToken())
                    .build();
            billingClient.acknowledgePurchase(ackParams, ackResult -> { });
        }
        settlePurchaseCall(purchase, null);
    }

    private void settlePurchaseCall(Purchase purchase, String error) {
        PluginCall call = pendingPurchaseCall;
        pendingPurchaseCall = null;
        if (call == null) return;
        if (error != null) {
            call.reject(error);
            return;
        }
        JSObject result = new JSObject();
        result.put("productId", purchase.getProducts().get(0));
        result.put("receipt", purchase.getPurchaseToken());
        call.resolve(result);
    }

    @PluginMethod
    public void restorePurchases(PluginCall call) {
        ensureConnected(new ConnectionCallback() {
            @Override
            public void onReady() {
                QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build();
                billingClient.queryPurchasesAsync(params, (billingResult, purchases) -> {
                    if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        call.reject(billingResult.getDebugMessage());
                        return;
                    }
                    for (Purchase purchase : purchases) {
                        if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                            JSObject result = new JSObject();
                            result.put("receipt", purchase.getPurchaseToken());
                            call.resolve(result);
                            return;
                        }
                    }
                    call.reject("ไม่พบการซื้อเดิม");
                });
            }

            @Override
            public void onError(String message) {
                call.reject(message);
            }
        });
    }

    private interface ConnectionCallback {
        void onReady();
        void onError(String message);
    }

    private void ensureConnected(ConnectionCallback callback) {
        if (billingClient.isReady()) {
            callback.onReady();
            return;
        }
        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult billingResult) {
                if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    callback.onReady();
                } else {
                    callback.onError(billingResult.getDebugMessage());
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                // Will retry lazily via ensureConnected on the next call
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (billingClient != null) {
            billingClient.endConnection();
        }
    }
}
