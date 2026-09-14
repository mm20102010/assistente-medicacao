import SwiftUI


// MARK: - Paleta

private enum DiarioWatchPalette {

    // Fundo do Diário:
    // #07111c → #0d2440 → #0a1727
    static let backgroundTop = Color(
        red: 0.027,
        green: 0.067,
        blue: 0.110
    )

    static let backgroundMiddle = Color(
        red: 0.051,
        green: 0.141,
        blue: 0.251
    )

    static let backgroundBottom = Color(
        red: 0.039,
        green: 0.090,
        blue: 0.153
    )

    // Botões:
    // #2666a2 → #184a78
    static let buttonTop = Color(
        red: 0.149,
        green: 0.400,
        blue: 0.635
    )

    static let buttonBottom = Color(
        red: 0.094,
        green: 0.290,
        blue: 0.471
    )

    static let secondaryText = Color(
        red: 0.616,
        green: 0.800,
        blue: 1.000
    )
}


// MARK: - Ajustes visuais

private enum DiarioWatchLayout {

    // =========================================================
    // HEADER
    // =========================================================

    // Quanto mais negativo, mais alto fica o header.
    static let headerY: CGFloat = -38

    // Quanto maior, mais para a direita.
    // Quanto menor, mais para a esquerda.
    static let headerLeading: CGFloat = 21

    // Espaço entre o ícone e "Diário".
    static let headerSpacing: CGFloat = 5


    // =========================================================
    // ÁREA ROLÁVEL
    // =========================================================

    // Distância entre o topo da tela rolável
    // e o primeiro medicamento.
    //
    // Quanto MENOR, mais alto começa o primeiro botão.
    static let medicinesTop: CGFloat = 0
    
    // Altura da região protegida do header.
    static let headerProtectionHeight: CGFloat = 52

    // Espaço disponível abaixo do último medicamento.
    //
    // Quanto MENOR, mais para baixo o último botão consegue ir.
    static let medicinesBottom: CGFloat = 4

    // Margem lateral da lista.
    static let medicinesHorizontal: CGFloat = 8

    // Espaço entre os botões.
    static let medicineSpacing: CGFloat = 12


    // =========================================================
    // BOTÕES
    // =========================================================

    // Altura mínima de cada botão.
    static let medicineHeight: CGFloat = 54

    // Arredondamento dos botões.
    static let medicineCornerRadius: CGFloat = 14

    // Padding horizontal interno do botão.
    static let medicineInternalHorizontal: CGFloat = 10


    // =========================================================
    // CONFIRMAÇÃO
    // =========================================================

    // Quanto MAIOR, mais baixa fica a confirmação.
    static let confirmationY: CGFloat = 36

    static let confirmationHorizontalPadding: CGFloat = 9
    static let confirmationVerticalPadding: CGFloat = 5
}


// MARK: - Estilo dos botões

private struct MedicationButtonStyle: ButtonStyle {

    func makeBody(configuration: Configuration) -> some View {

        configuration.label
            .font(.headline)
            .foregroundStyle(.white)

            .frame(
                maxWidth: .infinity,
                minHeight: DiarioWatchLayout.medicineHeight
            )

            .padding(
                .horizontal,
                DiarioWatchLayout.medicineInternalHorizontal
            )

            .background(
                LinearGradient(
                    colors: [
                        DiarioWatchPalette.buttonTop,
                        DiarioWatchPalette.buttonBottom
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )

            .clipShape(
                RoundedRectangle(
                    cornerRadius:
                        DiarioWatchLayout.medicineCornerRadius,
                    style: .continuous
                )
            )

            .overlay {
                RoundedRectangle(
                    cornerRadius:
                        DiarioWatchLayout.medicineCornerRadius,
                    style: .continuous
                )
                .stroke(
                    .white.opacity(0.13),
                    lineWidth: 1
                )
            }

            .shadow(
                color: .black.opacity(0.20),
                radius: 4,
                y: 2
            )

            .scaleEffect(
                configuration.isPressed ? 0.97 : 1
            )

            .opacity(
                configuration.isPressed ? 0.88 : 1
            )

            .animation(
                .easeOut(duration: 0.12),
                value: configuration.isPressed
            )
    }
}


// MARK: - Tela principal

struct ContentView: View {

    @StateObject private var watch = WatchSessionManager()

    var body: some View {

        ZStack {

            // =====================================================
            // FUNDO
            // =====================================================

            LinearGradient(
                colors: [
                    DiarioWatchPalette.backgroundTop,
                    DiarioWatchPalette.backgroundMiddle,
                    DiarioWatchPalette.backgroundBottom
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()


            // =====================================================
            // CONTEÚDO / MEDICAMENTOS
            //
            // Esta camada ocupa praticamente toda a tela.
            // Header e confirmação são overlays independentes.
            // =====================================================

            if watch.medicines.isEmpty {

                VStack(spacing: 6) {

                    ProgressView()
                        .tint(
                            DiarioWatchPalette.secondaryText
                        )

                    Text(watch.text("waitingPhone", fallback: "Aguardando iPhone…"))
                        .font(.caption2)
                        .foregroundStyle(
                            .white.opacity(0.72)
                        )
                        .multilineTextAlignment(.center)
                }

            } else {

                ScrollView {

                    LazyVStack(
                        spacing:
                            DiarioWatchLayout.medicineSpacing
                    ) {

                        ForEach(
                            watch.medicines,
                            id: \.self
                        ) { medicine in

                            Button {

                                watch.registerMedication(
                                    medicine
                                )

                            } label: {

                                Text(medicine)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.72)
                            }

                            .buttonStyle(
                                MedicationButtonStyle()
                            )
                        }
                    }

                    .padding(
                        .horizontal,
                        DiarioWatchLayout.medicinesHorizontal
                    )

                    .padding(
                        .top,
                        DiarioWatchLayout.medicinesTop
                    )

                    .padding(
                        .bottom,
                        DiarioWatchLayout.medicinesBottom
                    )
                }

                .scrollIndicators(.hidden)
            }

            // =====================================================
            // PROTEÇÃO VISUAL SUPERIOR
            //
            // Começa no topo FÍSICO da tela, inclusive na safe area.
            // Os medicamentos passam por trás desta camada e
            // desaparecem antes de alcançar o header.
            // =====================================================

            VStack(spacing: 0) {

                LinearGradient(
                    stops: [
                        .init(
                            color: DiarioWatchPalette.backgroundMiddle,
                            location: 0
                        ),
                        .init(
                            color: DiarioWatchPalette.backgroundMiddle,
                            location: 0.75
                        ),
                        .init(
                            color: DiarioWatchPalette.backgroundMiddle.opacity(0),
                            location: 1
                        )
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(
                    height: DiarioWatchLayout.headerProtectionHeight
                )

                Spacer(minLength: 0)
            }
            .ignoresSafeArea(edges: .top)
            .allowsHitTesting(false)
            .zIndex(5)
            
            // =====================================================
            // HEADER FIXO
            //
            // Não ocupa espaço vertical do ScrollView.
            // =====================================================

            VStack {

                HStack(
                    spacing:
                        DiarioWatchLayout.headerSpacing
                ) {

                    Image(systemName: "pills.fill")
                        .font(.caption)
                        .foregroundStyle(
                            DiarioWatchPalette.secondaryText
                        )

                    Text(watch.text("title", fallback: "Diário"))
                        .font(.headline)
                        .foregroundStyle(.white)

                    Spacer()
                }

                Spacer()
            }

            .padding(
                .leading,
                DiarioWatchLayout.headerLeading
            )

            .offset(
                y:
                    DiarioWatchLayout.headerY
            )

            .allowsHitTesting(false)

            .zIndex(10)


            // =====================================================
            // CONFIRMAÇÃO FIXA
            //
            // Não reserva footer nem reduz a altura da lista.
            // =====================================================

            if let deliveryMessage =
                watch.deliveryMessage {

                VStack {

                    Spacer()

                    Text(deliveryMessage)

                        .font(
                            .caption2.weight(.semibold)
                        )

                        .foregroundStyle(
                            .white.opacity(0.92)
                        )

                        .lineLimit(2)

                        .multilineTextAlignment(.center)

                        .padding(
                            .horizontal,
                            DiarioWatchLayout
                                .confirmationHorizontalPadding
                        )

                        .padding(
                            .vertical,
                            DiarioWatchLayout
                                .confirmationVerticalPadding
                        )

                        .background(
                            .ultraThinMaterial.opacity(0.72)
                        )

                        .clipShape(
                            Capsule()
                        )

                        .overlay {
                            Capsule()
                                .stroke(
                                    .white.opacity(0.11),
                                    lineWidth: 1
                                )
                        }

                        .offset(
                            y:
                                DiarioWatchLayout.confirmationY
                        )

                        .allowsHitTesting(false)

                        .transition(.opacity)
                }

                .zIndex(20)
            }
        }
    }
}


// MARK: - Preview

#Preview {
    ContentView()
}
