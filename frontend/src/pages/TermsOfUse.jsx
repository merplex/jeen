export default function TermsOfUse() {
  return (
    <div className="max-w-lg mx-auto min-h-screen bg-white px-6 py-10 text-gray-700">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Terms of Use</h1>
      <p className="text-sm text-gray-400 mb-8">Last updated: August 24, 2026</p>

      <section className="mb-6">
        <p>
          Please read these Terms of Use carefully before using the C-T Scan app. By using the
          app, you agree to these terms in full.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Permitted Use</h2>
        <p className="text-sm">
          C-T Scan is a Chinese-Thai dictionary and learning app intended for personal,
          non-commercial use.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Your Account</h2>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>You are responsible for keeping your account and password secure</li>
          <li>You must provide accurate information when registering</li>
          <li>Sharing your account with others is not permitted</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Subscriptions</h2>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Learner and Superuser plans are paid subscriptions billed through Google Play or the Apple App Store, depending on your device</li>
          <li>Subscriptions renew automatically each billing period unless cancelled beforehand</li>
          <li>Cancel auto-renewal any time via Google Play or Apple ID subscription settings</li>
          <li>We do not process payments or refunds directly — all billing is handled by Google Play or Apple, subject to their refund policies</li>
          <li>Feature limits and quotas for each plan may change from time to time; we will make reasonable efforts to communicate material changes</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Sign-In Options</h2>
        <p className="text-sm">
          You may sign in with an email, phone number, or LINE ID. Where Google Sign-In or Apple
          Sign-In is offered, using it is optional and subject to that provider's own terms.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Content Accuracy</h2>
        <p className="text-sm">
          We make reasonable efforts to keep dictionary entries, translations, and pronunciation
          scoring accurate, but we do not guarantee completeness or correctness. The app is a
          learning aid, not a substitute for professional translation or language certification.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Disclaimer</h2>
        <p className="text-sm">
          The app is provided "as is." We do not guarantee uninterrupted service and are not
          liable for data loss or any decisions made based on app content.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Changes to These Terms</h2>
        <p className="text-sm">
          We may update these Terms from time to time. Continued use of the app after changes
          means you accept the updated Terms.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Contact Us</h2>
        <p className="text-sm">
          Questions? Email us at:{' '}
          <a href="mailto:merplex@gmail.com" className="text-blue-600 underline">
            merplex@gmail.com
          </a>
        </p>
      </section>
    </div>
  )
}
