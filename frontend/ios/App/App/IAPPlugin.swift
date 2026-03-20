//
//  IAPPlugin.swift
//  App
//
//  Created by Xiang Chuan on 20/3/2569 BE.
//

import Capacitor
  import StoreKit

  @objc(IAPPlugin)
  public class IAPPlugin: CAPPlugin, CAPBridgedPlugin {
      public let identifier = "IAPPlugin"
      public let jsName = "IAP"
      public let pluginMethods: [CAPPluginMethod] = [
          CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
          CAPPluginMethod(name: "restorePurchases", returnType: CAPPluginReturnPromise),
      ]

      @objc func purchase(_ call: CAPPluginCall) {
          guard let productId = call.getString("productId") else {
              call.reject("productId required"); return
          }
          Task {
              do {
                  let products = try await Product.products(for: [productId])
                  guard let product = products.first else {
                      call.reject("Product not found: \(productId)"); return
                  }
                  let result = try await product.purchase()
                  switch result {
                  case .success(let verification):
                      switch verification {
                      case .verified(let transaction):
                          guard let url = Bundle.main.appStoreReceiptURL,
                                let data = try? Data(contentsOf: url) else {
                              call.reject("Cannot read receipt"); return
                          }
                          await transaction.finish()
                          call.resolve(["productId": transaction.productID,
                                        "receipt": data.base64EncodedString()])
                      case .unverified(_, let err):
                          call.reject("Unverified: \(err.localizedDescription)")
                      }
                  case .userCancelled:
                      call.reject("cancelled")
                  case .pending:
                      call.reject("pending")
                  @unknown default:
                      call.reject("unknown")
                  }
              } catch {
                  call.reject(error.localizedDescription)
              }
          }
      }

      @objc func restorePurchases(_ call: CAPPluginCall) {
          Task {
              if let url = Bundle.main.appStoreReceiptURL,
                 let data = try? Data(contentsOf: url) {
                  call.resolve(["receipt": data.base64EncodedString()])
              } else {
                  call.resolve(["receipt": ""])
              }
          }
      }
  }
