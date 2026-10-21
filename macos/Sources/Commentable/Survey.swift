import AppKit
import SwiftUI

// ========== アンケート ==========
// 集計はアプリで保持する（集計ウィンドウを閉じても結果が残る）
final class SurveyManager: ObservableObject {
    struct Survey {
        let id: String
        let question: String
        let choices: [String]
        let multiple: Bool
        var counts: [Int]
        var voters: Set<String> = []
        var active = true

        var respondents: Int { voters.count }

        // サーバーに送る形
        var payload: [String: Any] {
            ["id": id, "question": question, "choices": choices, "multiple": multiple]
        }
    }

    @Published private(set) var survey: Survey?

    // サーバーへの中継（配信画面の接続を使う）
    var onStart: ((Survey) -> Void)?
    var onEnd: ((Survey) -> Void)?

    // 再接続時に配信し直すため
    var activeSurvey: Survey? { survey?.active == true ? survey : nil }

    func start(question: String, choices: [String], multiple: Bool) throws {
        let question = question.trimmingCharacters(in: .whitespacesAndNewlines)
        let choices = choices.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard !question.isEmpty, choices.count >= 2 else {
            throw NSError(domain: "Survey", code: 1, userInfo: [NSLocalizedDescriptionKey: "質問と2つ以上の選択肢を入力してください。"])
        }
        end()
        let survey = Survey(id: UUID().uuidString.lowercased(), question: question, choices: choices, multiple: multiple,
                            counts: Array(repeating: 0, count: choices.count))
        self.survey = survey
        onStart?(survey)
    }

    func end() {
        guard var survey, survey.active else { return }
        survey.active = false
        self.survey = survey
        onEnd?(survey)
    }

    // 回答を集計（サーバーでも重複は弾いているが念のためここでも確認）
    func record(_ data: Any?) {
        guard var survey, survey.active, let data = data as? [String: Any], data["id"] as? String == survey.id else { return }
        let voterID = data["voterId"].map { "\($0)" } ?? UUID().uuidString
        guard !survey.voters.contains(voterID) else { return }
        survey.voters.insert(voterID)
        for case let index as Int in (data["choices"] as? [Any] ?? []) where survey.counts.indices.contains(index) {
            survey.counts[index] += 1
        }
        self.survey = survey
    }
}

// アンケート作成・集計ウィンドウ
struct SurveyView: View {
    private static let maxChoices = 20

    @ObservedObject var manager: SurveyManager
    @State private var editing: Bool
    @State private var question = ""
    @State private var choices = [Choice(), Choice(), Choice()]
    @State private var multiple = false
    @State private var error: String?
    @FocusState private var focusedChoice: UUID?

    // 行を削除しても入力欄がずれないように ID を付ける
    struct Choice: Identifiable {
        let id = UUID()
        var text = ""
    }

    init(manager: SurveyManager) {
        self.manager = manager
        // 開いたときに実施中・前回のアンケートがあれば結果を表示
        _editing = State(initialValue: manager.survey == nil)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if editing { editView } else { resultView }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minWidth: 480, minHeight: 520)
    }

    // ========== 作成画面 ==========
    private var editView: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("アンケート作成").font(.title).bold()

            Text("質問").bold()
            TextEditor(text: $question)
                .font(.body)
                .frame(height: 56)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.4)))
            Text("例：今日の授業の理解度は？").font(.caption).foregroundColor(.secondary)

            Text("選択肢").bold()
            ForEach($choices) { $choice in
                let index = choices.firstIndex { $0.id == choice.id } ?? 0
                HStack {
                    TextField("選択肢 \(index + 1)", text: $choice.text)
                        .textFieldStyle(.roundedBorder)
                        .focused($focusedChoice, equals: choice.id)
                        .onSubmit { nextChoice(after: choice.id) } // Enter で次の選択肢へ（最後なら追加）
                    Button("×") { removeChoice(choice.id) }.help("削除")
                }
            }
            Button("＋ 選択肢を追加") {
                addChoice()
            }
            .disabled(choices.count >= Self.maxChoices)

            Toggle("複数選択を許可する", isOn: $multiple)

            if let error {
                Text(error).foregroundColor(.red)
            }

            HStack {
                if manager.survey != nil {
                    Button("前回の結果を見る") { editing = false }
                }
                Spacer()
                Button("アンケート開始") { startSurvey() }
                    .keyboardShortcut(.defaultAction)
            }
        }
    }

    private func addChoice() {
        guard choices.count < Self.maxChoices else { return }
        let choice = Choice()
        choices.append(choice)
        focusedChoice = choice.id
    }

    private func nextChoice(after id: UUID) {
        if let index = choices.firstIndex(where: { $0.id == id }), index + 1 < choices.count {
            focusedChoice = choices[index + 1].id
        } else {
            addChoice()
        }
    }

    private func removeChoice(_ id: UUID) {
        guard let index = choices.firstIndex(where: { $0.id == id }) else { return }
        if choices.count > 2 {
            choices.remove(at: index)
        } else {
            choices[index].text = ""
        }
    }

    private func startSurvey() {
        do {
            try manager.start(question: question, choices: choices.map(\.text), multiple: multiple)
            error = nil
            editing = false
        } catch {
            self.error = error.localizedDescription
        }
    }

    // ========== 結果画面 ==========
    @ViewBuilder
    private var resultView: some View {
        if let survey = manager.survey {
            HStack(spacing: 12) {
                Text("アンケート結果").font(.title).bold()
                Text(survey.active ? "実施中" : "終了")
                    .font(.caption).bold()
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(survey.active ? Color.green : Color.gray)
                    .foregroundColor(.white)
                    .cornerRadius(4)
            }
            Text(survey.question).font(.title3).bold().textSelection(.enabled)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("回答者数：").foregroundColor(.secondary)
                Text("\(survey.respondents)").font(.title3).bold()
                Text("人").foregroundColor(.secondary)
            }

            ForEach(survey.choices.indices, id: \.self) { index in
                let count = survey.counts[index]
                let percent = survey.respondents > 0 ? Int((Double(count) / Double(survey.respondents) * 100).rounded()) : 0
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(survey.choices[index])
                        Spacer()
                        Text("\(count) 票（\(percent)%）").bold()
                    }
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 6).fill(Color.secondary.opacity(0.15))
                            RoundedRectangle(cornerRadius: 6).fill(Color.accentColor)
                                .frame(width: geometry.size.width * CGFloat(percent) / 100)
                                .animation(.easeOut(duration: 0.4), value: percent)
                        }
                    }
                    .frame(height: 28)
                }
            }

            HStack {
                Button("新しいアンケートを作成") { newSurvey() }
                Spacer()
                if survey.active {
                    Button("アンケート終了") {
                        if Dialogs.confirm("アンケートを終了しますか？", detail: "参加者の回答画面は閉じられます。", ok: "終了") {
                            manager.end()
                        }
                    }
                }
            }
            .padding(.top, 8)
        }
    }

    private func newSurvey() {
        guard let survey = manager.survey else { return }
        if survey.active {
            guard Dialogs.confirm("実施中のアンケートを終了して、新しいアンケートを作成しますか？", ok: "終了して作成") else { return }
            manager.end()
        }
        // 前回の内容を下書きにする
        question = survey.question
        choices = survey.choices.map { Choice(text: $0) }
        multiple = survey.multiple
        error = nil
        editing = true
    }
}
